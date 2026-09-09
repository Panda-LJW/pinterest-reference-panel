const token = document.querySelector('meta[name="pinterest-panel-token"]')?.content ?? "";
const referenceSessionId = document.querySelector('meta[name="pinterest-reference-session"]')?.content ?? "";
const DEFAULT_API_TIMEOUT_MS = 8_000;
const THUMBNAIL_TIMEOUT_MS = 20_000;
const REFRESH_TIMEOUT_MS = 120_000;
const elementIds = ["watcherSummary", "refreshButton", "pinsTab", "boardsTab", "statusBanner", "boardFilter", "content", "loadMoreButton", "toast", "searchInput", "clearSearch", "sortSelect", "browseTools", "resultSummary", "listEnd", "referenceTray", "selectionCount", "selectionStatus", "selectionList", "selectionHint", "clearSelection", "copySelection", "previewDialog", "previewPosition", "closePreview", "previewStage", "previewMessage", "previewImage", "previousPreview", "nextPreview", "previewTitle", "previewMeta", "previewCopy", "previewSelect"];
const elements = Object.fromEntries(elementIds.map(id => [id, document.querySelector(`#${id}`)]));
const state = {
  tab: "pins", boardId: null, boardTitle: null, query: "", sort: "recent",
  assets: [], boards: [], total: 0, libraryTotal: 0, nextCursor: null,
  version: null, watcherStatus: "starting", transfer: null, refreshedAt: null,
  initialLoading: true, pageLoading: false, pageGeneration: 0, dataView: null,
  pageError: null, refreshing: false, offline: false,
  copiedAssetId: null, pendingCopies: new Set(),
  thumbnailUrls: new Map(), thumbnailFailures: new Set(), thumbnailRequests: new Map(),
  thumbnailEpoch: 0, thumbnailActive: 0, thumbnailWaiters: [],
  selection: null, selectionError: null, selectionPending: 0, selectionChain: Promise.resolve(), copyingSelection: false,
  previewAsset: null, previewUrl: null, previewGeneration: 0, previewController: null,
  previewClosing: false, previewCloseToken: 0,
  polling: false, pollTimer: null, pollDelay: 2000, toastTimer: null, searchTimer: null
};

// Motion follows confirmed state; it never delays a request or changes a selection.
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const nodeMotions = new WeakMap();
const activeMotions = new Set();
function playMotion(node, frames, options = {}) {
  nodeMotions.get(node)?.cancel();
  if (!node?.isConnected || !node.animate || reducedMotion?.matches) return null;
  const animation = node.animate(frames, { duration: 200, easing: "cubic-bezier(.22,1,.36,1)", ...options });
  nodeMotions.set(node, animation); activeMotions.add(animation);
  const release = () => {
    activeMotions.delete(animation);
    if (nodeMotions.get(node) === animation) nodeMotions.delete(node);
  };
  animation.finished.then(release, release);
  return animation;
}
function pulseControl(node) {
  playMotion(node, [{ transform: "scale(.86)" }, { transform: "scale(1.1)", offset: .55 }, { transform: "scale(1)" }], { duration: 220 });
}
reducedMotion?.addEventListener("change", () => {
  if (reducedMotion.matches) for (const animation of activeMotions) animation.cancel();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, label, onClick) {
  const node = element("button", className, text);
  node.type = "button";
  if (label) { node.setAttribute("aria-label", label); node.title = label; }
  node.addEventListener("click", onClick);
  return node;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function viewKey() { return JSON.stringify([state.tab, state.boardId, state.query, state.sort]); }
function selectedIndex(assetId) { return state.selection?.entries.findIndex(entry => entry.id === assetId) ?? -1; }

async function api(path, options = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  const headers = new Headers(options.headers ?? {});
  headers.set("X-Pinterest-Panel-Token", token);
  if (referenceSessionId) headers.set("X-Pinterest-Reference-Session", referenceSessionId);
  headers.set("Accept", options.expectBlob ? "image/*" : "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET", credentials: "same-origin", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal
    });
    if (!response.ok) {
      let message = `请求失败（${response.status}）`;
      try { message = (await response.json()).error || message; } catch (error) { if (error?.name === "AbortError") throw error; }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return options.expectBlob ? await response.blob() : await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("本地服务响应超时");
    throw error;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel); }
}
function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  const feedback = document.querySelector("#previewFeedback");
  if (feedback && elements.previewDialog.open) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  }
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), isError ? 5000 : 3000);
}
function clearThumbnailCache() {
  state.thumbnailEpoch += 1;
  for (const url of state.thumbnailUrls.values()) URL.revokeObjectURL(url);
  state.thumbnailUrls.clear();
  state.thumbnailFailures.clear();
}
async function withThumbnailSlot(task) {
  if (state.thumbnailActive >= 4) await new Promise(resolve => state.thumbnailWaiters.push(resolve));
  state.thumbnailActive += 1;
  try { return await task(); }
  finally { state.thumbnailActive -= 1; state.thumbnailWaiters.shift()?.(); }
}
function thumbnailUrl(assetId) {
  const cached = state.thumbnailUrls.get(assetId);
  if (cached) return Promise.resolve(cached);
  const epoch = state.thumbnailEpoch;
  const requestKey = `${epoch}:${assetId}`;
  if (state.thumbnailRequests.has(requestKey)) return state.thumbnailRequests.get(requestKey);
  const pending = withThumbnailSlot(async () => {
    if (epoch !== state.thumbnailEpoch) throw new Error("thumbnail-generation-changed");
    try {
      const blob = await api(`/api/thumbnails/${assetId}`, { expectBlob: true, timeoutMs: THUMBNAIL_TIMEOUT_MS });
      if (epoch !== state.thumbnailEpoch) throw new Error("thumbnail-generation-changed");
      const url = URL.createObjectURL(blob);
      state.thumbnailUrls.set(assetId, url);
      return url;
    } catch (error) {
      if (epoch !== state.thumbnailEpoch) throw new Error("thumbnail-generation-changed");
      throw error;
    }
  }).finally(() => state.thumbnailRequests.delete(requestKey));
  state.thumbnailRequests.set(requestKey, pending);
  return pending;
}
const observedThumbnails = new Set();
const thumbnailObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    thumbnailObserver.unobserve(entry.target);
    observedThumbnails.delete(entry.target);
    void loadThumbnail(entry.target);
  }
}, { rootMargin: "300px" });
function thumbnailImage(assetId, alt = "") {
  const image = document.createElement("img");
  image.alt = alt;
  image.decoding = "async";
  image.dataset.assetId = assetId;
  image.dataset.thumbnailState = "pending";
  return image;
}
function hydrateThumbnails() {
  for (const image of observedThumbnails) if (!image.isConnected) {
    thumbnailObserver?.unobserve(image); observedThumbnails.delete(image);
  }
  for (const image of document.querySelectorAll('img[data-thumbnail-state="pending"]')) {
    image.dataset.thumbnailState = "waiting";
    if (thumbnailObserver && !state.thumbnailUrls.has(image.dataset.assetId)) {
      thumbnailObserver.observe(image); observedThumbnails.add(image);
    }
    else void loadThumbnail(image);
  }
}
async function loadThumbnail(image) {
  if (!image.isConnected) return;
  const assetId = image.dataset.assetId;
  const frame = image.closest(".thumb-frame, .cover, .selection-thumb");
  const fail = () => {
    state.thumbnailFailures.add(assetId);
    frame?.classList.add("has-error");
    frame?.querySelector(".thumb-skeleton")?.remove();
    image.dataset.thumbnailState = "error";
    image.remove();
  };
  if (!assetId || state.thumbnailFailures.has(assetId)) { fail(); return; }
  image.dataset.thumbnailState = "loading";
  try {
    const url = await thumbnailUrl(assetId);
    if (!image.isConnected) return;
    image.addEventListener("load", () => {
      image.classList.add("is-loaded");
      image.dataset.thumbnailState = "loaded";
      frame?.querySelector(".thumb-skeleton")?.remove();
    }, { once: true });
    image.addEventListener("error", fail, { once: true });
    image.src = url;
  } catch (error) { if (error?.message !== "thumbnail-generation-changed" && image.isConnected) fail(); }
}
function mergeSummary(summary, acceptVersion = true) {
  if (!summary) return;
  if (acceptVersion && Number.isInteger(summary.version)) state.version = summary.version;
  if (summary.watcherStatus) state.watcherStatus = summary.watcherStatus;
  if (summary.transfer) state.transfer = summary.transfer;
  if (summary.refreshedAt) state.refreshedAt = summary.refreshedAt;
}
function updateChrome() {
  const status = state.offline ? ["正在重连", "offline"]
    : state.watcherStatus === "watching" ? [`${state.libraryTotal} 张 · 已同步`, "watching"]
      : state.watcherStatus === "degraded" ? ["周期扫描中", "degraded"]
        : state.watcherStatus === "stopped" ? ["监听已停止", "stopped"] : ["连接中", "starting"];
  elements.watcherSummary.textContent = status[0];
  elements.watcherSummary.dataset.state = status[1];
  for (const [tab, node] of [["pins", elements.pinsTab], ["boards", elements.boardsTab]]) {
    node.classList.toggle("is-active", state.tab === tab);
    node.setAttribute("aria-pressed", String(state.tab === tab));
  }
  elements.refreshButton.disabled = state.refreshing;
  elements.clearSearch.hidden = !state.query;
  elements.sortSelect.disabled = state.tab === "boards";
  elements.searchInput.placeholder = state.tab === "boards" ? "搜索图版名称" : "搜索标题、图版或 Pin ID";
  const banner = state.offline ? "连接暂时中断，现有素材保留。正在自动重连，也可点击刷新重试。"
    : (state.transfer?.failed ?? 0) > 0 ? `有 ${state.transfer.failed} 个文件未能收取，原文件仍保留在下载临时区。`
      : state.watcherStatus === "degraded" ? "实时监听暂不可用，周期扫描仍在运行。" : "";
  elements.statusBanner.hidden = !banner;
  elements.statusBanner.classList.toggle("is-danger", state.offline || (state.transfer?.failed ?? 0) > 0);
  elements.statusBanner.textContent = banner;
  elements.content.setAttribute("aria-busy", String(state.pageLoading || state.initialLoading));
  elements.content.inert = state.pageLoading && state.dataView !== viewKey();
  elements.loadMoreButton.disabled = state.pageLoading;
  elements.loadMoreButton.textContent = state.pageLoading ? "正在加载…" : "继续加载";
  elements.resultSummary.textContent = state.initialLoading ? "正在读取素材…"
    : state.pageLoading ? "正在查找…" : state.pageError ? "读取失败，请重试"
      : state.tab === "boards" ? `${visibleBoards().length} 个图版`
        : state.query ? `找到 ${state.total} 张图片` : `${state.boardTitle || "全部素材"} · ${state.total} 张`;
  const filterKey = state.tab === "pins" ? state.boardId ?? "" : "";
  elements.boardFilter.hidden = !filterKey;
  if (elements.boardFilter.dataset.key !== filterKey) {
    elements.boardFilter.dataset.key = filterKey;
    elements.boardFilter.replaceChildren();
    if (filterKey) elements.boardFilter.append(button("filter-clear", "返回全部 ×", "显示全部", () => {
      state.boardId = null; state.boardTitle = null; void loadPage({ reset: true });
    }));
  }
}
function emptyState(title, detail, actionLabel, action) {
  const wrapper = element("section", "empty-state");
  const inner = element("div", "empty-state-inner");
  inner.append(element("div", "empty-mark", "P"), element("h2", "", title), element("p", "", detail));
  if (action) inner.append(button("button secondary", actionLabel, null, action));
  wrapper.append(inner);
  return wrapper;
}
function applyCopyState(card, assetId) {
  const copying = state.pendingCopies.has(assetId);
  const copied = state.copiedAssetId === assetId;
  card.classList.toggle("is-copying", copying);
  card.classList.toggle("is-copied", copied);
  const action = card.querySelector(".pin-copy");
  action.textContent = copying ? "…" : copied ? "✓" : "复制";
  action.setAttribute("aria-busy", String(copying));
}
function updateCopyState(assetId) {
  if (!assetId) return;
  for (const card of elements.content.querySelectorAll(".pin-card")) if (card.dataset.assetId === assetId) applyCopyState(card, assetId);
  if (state.previewAsset?.id === assetId) {
    elements.previewCopy.setAttribute("aria-busy", String(state.pendingCopies.has(assetId)));
    elements.previewCopy.textContent = state.pendingCopies.has(assetId) ? "复制中…" : "复制路径";
  }
}
function applySelectionState(card) {
  const id = card.dataset.assetId;
  const index = selectedIndex(id);
  const action = card.querySelector(".pin-select");
  const changed = card.classList.contains("is-selected") !== (index >= 0);
  card.classList.toggle("is-selected", index >= 0);
  action.textContent = index >= 0 ? String(index + 1) : "+";
  action.setAttribute("aria-pressed", String(index >= 0));
  action.setAttribute("aria-label", `${index >= 0 ? "移除参考" : "加入参考"}：${card.dataset.title}`);
  action.title = index >= 0 ? `参考图 ${index + 1} · 点击移除` : "加入参考篮";
  action.disabled = !state.selection || Boolean(state.selectionError);
  if (changed) pulseControl(action);
}
function pinCard(asset) {
  const card = element("article", "pin-card");
  card.dataset.assetId = asset.id;
  card.dataset.title = asset.title;
  const frame = element("div", "thumb-frame");
  const preview = button("preview-trigger", null, `预览：${asset.title}`, () => void openPreview(asset));
  preview.append(thumbnailImage(asset.id, asset.title), element("span", "thumb-skeleton"));
  frame.append(preview, button("pin-select", "+", `加入参考：${asset.title}`, () => toggleReference(asset)));
  const body = element("div", "pin-body");
  const copy = element("div", "pin-copy-text");
  const title = element("p", "pin-title", asset.title); title.title = asset.title;
  const meta = element("div", "pin-meta");
  meta.append(element("span", "", asset.boardTitle), element("span", "", asset.extension.slice(1).toUpperCase()));
  copy.append(title, meta);
  body.append(copy, button("pin-copy", "复制", `复制路径：${asset.title}`, () => void copyAsset(asset)));
  card.append(frame, body);
  applyCopyState(card, asset.id); applySelectionState(card);
  return card;
}
function visibleBoards() {
  const words = state.query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return state.boards.filter(board => words.every(word => board.title.normalize("NFKC").toLocaleLowerCase().includes(word)));
}
function boardCard(board) {
  const card = button("board-card", null, `打开图版 ${board.title}`, () => {
    state.tab = "pins"; state.boardId = board.id; state.boardTitle = board.title;
    state.query = ""; elements.searchInput.value = ""; void loadPage({ reset: true });
  });
  const covers = element("div", "board-covers");
  for (let index = 0; index < 3; index += 1) {
    const cover = element("span", "cover");
    if (board.coverAssetIds[index]) cover.append(thumbnailImage(board.coverAssetIds[index]));
    covers.append(cover);
  }
  const body = element("div", "board-body");
  const meta = element("div", "board-meta");
  meta.append(element("span", "", `${board.pinCount} 张图片`), element("span", "", "查看 →"));
  body.append(element("strong", "", board.title), meta);
  card.append(covers, body);
  return card;
}
// Reuse cards and image nodes on pagination and state changes.
function reconcileGrid(className, records, key, stamp, create) {
  let grid = elements.content.firstElementChild;
  if (!grid?.classList.contains(className)) {
    grid = element("section", className);
    elements.content.replaceChildren(grid);
  }
  const existing = new Map([...grid.children].map(node => [node.dataset.key, node]));
  const keep = new Set();
  let cursor = grid.firstElementChild;
  for (const [index, record] of records.entries()) {
    const id = key(record), signature = stamp(record);
    let card = existing.get(id);
    if (!card || card.dataset.stamp !== signature) {
      card = create(record); card.dataset.key = id; card.dataset.stamp = signature;
      card.style.setProperty("--enter-delay", `${Math.min(index, 6) * 18}ms`);
    }
    if (card !== cursor) grid.insertBefore(card, cursor);
    cursor = card.nextElementSibling;
    keep.add(card);
  }
  for (const child of [...grid.children]) if (!keep.has(child)) child.remove();
}
function renderContent() {
  updateChrome();
  if (state.initialLoading) return;
  if ((state.pageError && state.dataView !== viewKey()) || (state.offline && !state.assets.length && !state.boards.length)) {
    elements.content.replaceChildren(emptyState("暂时无法读取素材", state.pageError || "请确认插件仍在运行，或稍后重试。", "重新加载", () => void loadPage({ reset: true })));
    elements.loadMoreButton.hidden = true; elements.listEnd.hidden = true; return;
  }
  if (state.tab === "boards") {
    const boards = visibleBoards();
    if (boards.length) reconcileGrid("boards-grid", boards, board => board.id, board => JSON.stringify(board), boardCard);
    else elements.content.replaceChildren(emptyState(state.query ? "没有匹配的图版" : "还没有图版", state.query ? "试试更短的关键词，或清除搜索。" : "从 Pinterest 下载图片后，素材文件夹会显示在这里。"));
    elements.loadMoreButton.hidden = true; elements.listEnd.hidden = true;
  } else {
    if (state.assets.length) reconcileGrid("masonry", state.assets, asset => asset.id, asset => `${asset.updatedAt}:${asset.size}:${state.thumbnailEpoch}`, pinCard);
    else elements.content.replaceChildren(emptyState(state.query ? "没有找到相关图片" : state.boardId ? "这个图版还没有图片" : "留下一点灵感", state.query ? "搜索会覆盖整个素材库。试试其他标题、图版名称或 Pin ID。" : "在 Pinterest 扩展中下载图片，它们会自动出现在这里。", state.query ? "清除搜索" : null, state.query ? clearSearch : null));
    elements.loadMoreButton.hidden = !state.nextCursor;
    elements.listEnd.hidden = !state.assets.length || Boolean(state.nextCursor);
  }
  hydrateThumbnails();
}
async function copyAsset(asset) {
  if (state.pendingCopies.size || state.copyingSelection) { showToast("正在复制，请稍候"); return; }
  clearCopyFeedback();
  state.pendingCopies.add(asset.id); updateCopyState(asset.id);
  try {
    const result = await api("/api/clipboard", { method: "POST", body: { assetId: asset.id } });
    if (result.status !== "copied" || result.assetId !== asset.id) throw new Error("未收到复制确认，请重试");
    state.copiedAssetId = asset.id;
    for (const card of elements.content.querySelectorAll(".pin-card")) if (card.dataset.assetId === asset.id) pulseControl(card.querySelector(".pin-copy"));
    if (state.previewAsset?.id === asset.id) pulseControl(elements.previewCopy);
    showToast("绝对路径已复制 · 回到对话按 ⌘V");
  } catch (error) { showToast(error.message || "复制失败，请重试", true); }
  finally { state.pendingCopies.delete(asset.id); updateCopyState(asset.id); }
}
function clearCopyFeedback() {
  const previousAssetId = state.copiedAssetId;
  state.copiedAssetId = null;
  updateCopyState(previousAssetId);
}
async function loadPage({ reset = false } = {}) {
  if (!reset && state.pageLoading) return;
  if (reset) state.pageGeneration += 1;
  const generation = state.pageGeneration;
  const requestedTab = state.tab, requestedBoardId = state.boardId;
  const requestedQuery = state.query, requestedSort = state.sort;
  const requestedCursor = reset ? null : state.nextCursor;
  const isCurrentRequest = () => generation === state.pageGeneration && requestedTab === state.tab && requestedBoardId === state.boardId && requestedQuery === state.query && requestedSort === state.sort;
  state.pageLoading = true; state.pageError = null; updateChrome();
  try {
    const params = new URLSearchParams({ limit: "30", sort: requestedSort });
    if (requestedCursor) params.set("cursor", requestedCursor);
    if (requestedBoardId) params.set("boardId", requestedBoardId);
    if (requestedQuery && requestedTab === "pins") params.set("q", requestedQuery);
    const result = await api(`/api/inbox?${params}`);
    if (!isCurrentRequest()) return;
    const page = result.page;
    if (!reset && state.version !== null && page.version !== state.version) {
      // Offset cursors from different library versions must never be combined.
      return await loadPage({ reset: true });
    }
    if (state.version !== null && page.version !== state.version) clearThumbnailCache();
    state.assets = reset ? page.assets : [...state.assets, ...page.assets];
    state.boards = page.boards; state.total = page.total; state.libraryTotal = page.libraryTotal;
    state.nextCursor = page.nextCursor; state.dataView = viewKey();
    mergeSummary(page); state.offline = false; state.pollDelay = 2000;
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return;
    state.offline = true; state.pageError = error.message || "读取素材失败";
    showToast(state.pageError, true);
  } finally {
    if (isCurrentRequest()) { state.pageLoading = false; state.initialLoading = false; renderContent(); }
  }
}
async function refreshNow() {
  if (state.refreshing) return;
  state.refreshing = true; updateChrome();
  try {
    const result = await api("/api/refresh", { method: "POST", body: {}, timeoutMs: REFRESH_TIMEOUT_MS });
    mergeSummary(result, false); clearThumbnailCache();
    const loaded = await loadPage({ reset: true });
    if (referenceSessionId) await loadSelection();
    if (loaded) showToast("Pinterest Inbox 已刷新");
  } catch (error) { state.offline = true; showToast(error.message || "刷新失败", true); }
  finally { state.refreshing = false; updateChrome(); }
}
function applySelection(result) {
  if (state.selection && result.revision < state.selection.revision) return;
  const changed = JSON.stringify(result) !== JSON.stringify(state.selection);
  const countChanged = state.selection && result.entries.length !== state.selection.entries.length;
  state.selection = result; state.selectionError = null;
  if (changed) renderSelection(); else updateSelectionStatus();
  if (countChanged) pulseControl(elements.selectionCount);
}
async function loadSelection() {
  if (!referenceSessionId || state.selectionPending) return;
  try { applySelection(await api("/api/references")); }
  catch (error) { state.selectionError = error.message || "参考篮暂时不可用"; renderSelection(); }
}
function updateSelectionStatus() {
  const entries = state.selection?.entries ?? [];
  const unavailable = entries.some(entry => entry.status !== "ready");
  elements.selectionCount.textContent = `${entries.length} / 10`;
  elements.selectionStatus.textContent = state.selectionError ? "未同步" : state.selectionPending ? "保存中…" : unavailable ? "需要检查" : entries.length ? "已就绪" : "";
  elements.selectionStatus.classList.toggle("is-error", Boolean(state.selectionError) || unavailable);
  elements.clearSelection.disabled = !entries.length || Boolean(state.selectionPending) || !state.selection;
  elements.copySelection.disabled = !entries.length || unavailable || Boolean(state.selectionPending) || Boolean(state.selectionError) || state.copyingSelection;
  elements.copySelection.textContent = state.copyingSelection ? "复制中…" : "复制路径";
  elements.selectionHint.textContent = !referenceSessionId ? "此页可浏览素材；请让 Codex 为当前任务打开参考篮。"
    : state.selectionError || (unavailable ? "有参考图已变化或不可用，请移除后重新选择。"
      : entries.length ? "回到当前对话，说“使用选中的参考图”。编号对应左侧顺序。" : "点击图片上的 ＋，组合你的下一组参考。");
  elements.selectionHint.classList.toggle("is-error", Boolean(state.selectionError) || unavailable);
  elements.referenceTray.setAttribute("aria-busy", String(state.selectionPending > 0));
}
function renderSelection() {
  const trayBefore = elements.referenceTray.getBoundingClientRect();
  const positions = new Map([...elements.selectionList.children].map(node => [node.dataset.assetId, node.getBoundingClientRect()]));
  nodeMotions.get(elements.referenceTray)?.cancel();
  for (const node of elements.selectionList.children) nodeMotions.get(node)?.cancel();
  updateSelectionStatus();
  const focused = document.activeElement;
  const focusedItem = focused?.closest?.(".selection-item");
  const focusedId = focusedItem?.dataset.assetId;
  const focusedAction = focused?.dataset.selectionAction;
  const scrollLeft = elements.selectionList.scrollLeft;
  const entries = state.selection?.entries ?? [];
  elements.selectionList.hidden = !entries.length;
  // Polls with an unchanged selection never rebuild this tray.
  elements.selectionList.replaceChildren();
  entries.forEach((entry, index) => {
    const item = element("li", "selection-item");
    item.dataset.assetId = entry.id;
    item.classList.toggle("is-unavailable", entry.status !== "ready");
    const thumb = button("selection-thumb", null, `预览参考 ${index + 1}：${entry.title}`, () => void openPreview(entry));
    thumb.append(thumbnailImage(entry.id), element("span", "selection-number", String(index + 1)));
    const remove = button("selection-remove", "×", `移除参考 ${index + 1}`, () => mutateSelection(ids => ids.filter(id => id !== entry.id)));
    const order = element("div", "selection-order");
    const earlier = button("", "←", `参考 ${index + 1} 向前移动`, () => moveReference(entry.id, -1));
    const later = button("", "→", `参考 ${index + 1} 向后移动`, () => moveReference(entry.id, 1));
    earlier.disabled = index === 0; later.disabled = index === entries.length - 1;
    for (const [action, node] of [["preview", thumb], ["remove", remove], ["earlier", earlier], ["later", later]]) node.dataset.selectionAction = action;
    order.append(earlier, element("span", "", entry.status === "ready" ? String(index + 1).padStart(2, "0") : "失效"), later);
    item.append(thumb, remove, order); elements.selectionList.append(item);
  });
  elements.selectionList.scrollLeft = scrollLeft;
  if (focusedId) {
    const item = [...elements.selectionList.children].find(node => node.dataset.assetId === focusedId);
    const action = item?.querySelector(`[data-selection-action="${focusedAction}"]`);
    const fallback = item?.querySelector(".selection-thumb") || elements.selectionList.querySelector(".selection-thumb") || elements.searchInput;
    (action && !action.disabled ? action : fallback).focus({ preventScroll: true });
  }
  for (const card of elements.content.querySelectorAll(".pin-card")) applySelectionState(card);
  updatePreviewControls(); hydrateThumbnails();
  const trayOffset = trayBefore.top - elements.referenceTray.getBoundingClientRect().top;
  const items = [...elements.selectionList.children].map(node => ({ node, after: node.getBoundingClientRect(), before: positions.get(node.dataset.assetId) }));
  if (Math.abs(trayOffset) > 1) playMotion(elements.referenceTray, [{ transform: `translateY(${trayOffset}px)` }, { transform: "translateY(0)" }], { duration: 220 });
  for (const { node, before, after } of items) {
    if (!before) {
      playMotion(node, [{ opacity: 0, transform: "translateY(12px) scale(.9)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 220 });
    } else {
      const x = before.left - after.left, y = before.top - after.top - trayOffset;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) playMotion(node, [{ transform: `translate(${x}px,${y}px)` }, { transform: "translate(0,0)" }], { duration: 220 });
    }
  }
}
function mutateSelection(transform) {
  if (!state.selection || state.selectionError) { showToast(state.selectionError || "参考篮尚未就绪", true); return; }
  state.selectionPending += 1; updateSelectionStatus();
  state.selectionChain = state.selectionChain.then(async () => {
    if (state.selectionError) return;
    const assetIds = transform(state.selection.entries.map(entry => entry.id));
    try {
      const result = await api("/api/references", { method: "POST", body: { assetIds, revision: state.selection.revision } });
      applySelection(result);
    } catch (error) {
      showToast(error.message || "无法保存选择，请重试", true);
      // Stop queued edits after a conflict instead of applying stale user intent.
      state.selectionError = error.message;
      throw error;
    }
  }).catch(() => {}).finally(async () => {
    state.selectionPending -= 1;
    if (!state.selectionPending && state.selectionError) await loadSelection();
    updateSelectionStatus();
  });
}
function toggleReference(asset) {
  mutateSelection(ids => ids.includes(asset.id) ? ids.filter(id => id !== asset.id) : [...ids, asset.id]);
}
function moveReference(id, offset) {
  mutateSelection(ids => {
    const index = ids.indexOf(id), target = index + offset;
    if (index >= 0 && target >= 0 && target < ids.length) [ids[index], ids[target]] = [ids[target], ids[index]];
    return ids;
  });
}
async function copySelection() {
  if (state.pendingCopies.size || state.copyingSelection) { showToast("正在复制，请稍候"); return; }
  if (elements.copySelection.disabled) return;
  clearCopyFeedback();
  state.copyingSelection = true; updateSelectionStatus();
  const expectedCount = state.selection.entries.length;
  try {
    const result = await api("/api/references/clipboard", { method: "POST", body: { revision: state.selection.revision } });
    if (result.status !== "copied" || result.count !== expectedCount) throw new Error("未收到完整复制确认，请重试");
    pulseControl(elements.copySelection);
    showToast(`已复制 ${result.count} 张图片的路径 · 回到对话按 ⌘V`);
  } catch (error) { showToast(error.message || "复制失败", true); await loadSelection(); }
  finally { state.copyingSelection = false; updateSelectionStatus(); }
}
function updatePreviewControls() {
  if (!state.previewAsset) return;
  const index = selectedIndex(state.previewAsset.id);
  elements.previewSelect.textContent = index >= 0 ? `已选为参考 ${index + 1} · 移除` : "加入参考";
  elements.previewSelect.setAttribute("aria-pressed", String(index >= 0));
  elements.previewSelect.disabled = !state.selection || Boolean(state.selectionError);
  const position = state.assets.findIndex(asset => asset.id === state.previewAsset.id);
  elements.previousPreview.disabled = position <= 0;
  elements.nextPreview.disabled = position < 0 || position >= state.assets.length - 1;
  elements.previewPosition.textContent = position >= 0 ? `原图预览 · ${position + 1} / ${state.assets.length} 张已加载` : "参考图 · 原图预览";
}
async function openPreview(asset, direction = 0) {
  const wasOpen = elements.previewDialog.open;
  state.previewCloseToken += 1; state.previewClosing = false;
  elements.previewDialog.classList.remove("is-closing");
  nodeMotions.get(elements.previewDialog)?.cancel();
  nodeMotions.get(elements.previewImage)?.cancel();
  state.previewAsset = asset;
  const generation = ++state.previewGeneration;
  state.previewController?.abort();
  state.previewController = new AbortController();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  elements.previewImage.hidden = true; elements.previewImage.removeAttribute("src");
  elements.previewImage.alt = asset.title;
  document.querySelector("#previewFeedback").textContent = "";
  elements.previewTitle.textContent = asset.title;
  elements.previewMeta.textContent = `${asset.boardTitle} · ${asset.extension.slice(1).toUpperCase()} · ${formatBytes(asset.size)}`;
  elements.previewMessage.textContent = "正在读取原图…"; elements.previewMessage.hidden = false;
  updatePreviewControls(); updateCopyState(asset.id);
  if (!wasOpen) {
    elements.previewDialog.showModal();
    playMotion(elements.previewDialog, [{ opacity: 0, transform: "translateY(12px) scale(.98)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 220 });
  }
  try {
    const blob = await api(`/api/previews/${asset.id}`, { expectBlob: true, timeoutMs: 30_000, signal: state.previewController.signal });
    if (generation !== state.previewGeneration || !elements.previewDialog.open) return;
    const url = URL.createObjectURL(blob); state.previewUrl = url;
    elements.previewImage.onload = () => {
      if (generation !== state.previewGeneration) return;
      elements.previewImage.hidden = false; elements.previewMessage.hidden = true;
      playMotion(elements.previewImage, [{ opacity: 0, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: "translateX(0)" }], { duration: 180 });
    };
    elements.previewImage.onerror = () => {
      if (generation !== state.previewGeneration) return;
      elements.previewImage.hidden = true; elements.previewMessage.textContent = "浏览器无法显示这张原图，你仍可加入参考或复制路径。";
    };
    elements.previewImage.src = url;
  } catch (error) { if (generation === state.previewGeneration) elements.previewMessage.textContent = error.message || "原图暂时不可读"; }
}
function navigatePreview(offset) {
  const index = state.assets.findIndex(asset => asset.id === state.previewAsset?.id);
  const next = state.assets[index + offset];
  if (index >= 0 && next) void openPreview(next, offset);
}
async function dismissPreview() {
  if (!elements.previewDialog.open || state.previewClosing) return;
  state.previewClosing = true;
  const closeToken = ++state.previewCloseToken;
  state.previewGeneration += 1; state.previewController?.abort();
  elements.previewDialog.classList.add("is-closing");
  const animation = playMotion(elements.previewDialog, [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(8px) scale(.98)" }], { duration: 130, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  if (animation) await animation.finished.catch(() => {});
  if (closeToken !== state.previewCloseToken) return;
  elements.previewDialog.close();
  animation?.cancel();
}
function clearSearch() {
  clearTimeout(state.searchTimer); state.query = ""; elements.searchInput.value = "";
  void loadPage({ reset: true }); elements.searchInput.focus();
}
function schedulePoll(delay = state.pollDelay) {
  clearTimeout(state.pollTimer); state.pollTimer = setTimeout(() => void pollStatus(), delay);
}
async function pollStatus() {
  if (state.polling) return;
  if (document.hidden) { schedulePoll(3000); return; }
  state.polling = true;
  const knownVersion = state.version;
  try {
    const suffix = Number.isInteger(knownVersion) ? `?knownVersion=${knownVersion}` : "";
    const result = await api(`/api/status${suffix}`);
    mergeSummary(result, false); state.offline = false; state.pollDelay = 2000; updateChrome();
    if ((!result.unchanged || state.pageError) && !state.pageLoading) await loadPage({ reset: true });
    if (referenceSessionId) await loadSelection();
  } catch { state.offline = true; state.pollDelay = Math.min(10_000, Math.max(2000, state.pollDelay * 2)); updateChrome(); }
  finally { state.polling = false; schedulePoll(); }
}
elements.refreshButton.addEventListener("click", () => void refreshNow());
elements.loadMoreButton.addEventListener("click", () => void loadPage());
for (const [tab, node] of [["pins", elements.pinsTab], ["boards", elements.boardsTab]]) node.addEventListener("click", () => {
  clearTimeout(state.searchTimer); state.tab = tab; state.boardId = null; state.boardTitle = null;
  state.query = ""; elements.searchInput.value = ""; void loadPage({ reset: true });
});
elements.searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer); state.query = elements.searchInput.value;
  state.pageGeneration += 1; state.searchTimer = setTimeout(() => void loadPage({ reset: true }), 250); updateChrome();
});
elements.searchInput.addEventListener("keydown", event => { if (event.key === "Escape") clearSearch(); });
elements.clearSearch.addEventListener("click", clearSearch);
elements.sortSelect.addEventListener("change", () => { state.sort = elements.sortSelect.value; void loadPage({ reset: true }); });
elements.clearSelection.addEventListener("click", () => mutateSelection(() => []));
elements.copySelection.addEventListener("click", () => void copySelection());
elements.closePreview.addEventListener("click", () => void dismissPreview());
elements.previewDialog.addEventListener("cancel", event => { event.preventDefault(); void dismissPreview(); });
elements.previousPreview.addEventListener("click", () => navigatePreview(-1));
elements.nextPreview.addEventListener("click", () => navigatePreview(1));
elements.previewCopy.addEventListener("click", () => { if (state.previewAsset) void copyAsset(state.previewAsset); });
elements.previewSelect.addEventListener("click", () => { if (state.previewAsset) toggleReference(state.previewAsset); });
elements.previewDialog.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft") { event.preventDefault(); navigatePreview(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); navigatePreview(1); }
});
elements.previewDialog.addEventListener("close", () => {
  state.previewClosing = false;
  elements.previewDialog.classList.remove("is-closing");
  state.previewGeneration += 1; state.previewAsset = null;
  state.previewController?.abort(); state.previewController = null;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null; elements.previewImage.removeAttribute("src");
});
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
  document.documentElement.style.setProperty("--tray-height", `${elements.referenceTray.getBoundingClientRect().height}px`);
}).observe(elements.referenceTray);
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedulePoll(0); });
window.addEventListener("beforeunload", () => {
  thumbnailObserver?.disconnect();
  for (const url of state.thumbnailUrls.values()) URL.revokeObjectURL(url);
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
});
if (!token) {
  state.initialLoading = false; state.offline = true;
  elements.content.replaceChildren(emptyState("本地面板会话无效", "请从 Pinterest Inbox 插件重新打开。"));
  updateChrome();
} else {
  renderSelection();
  void Promise.all([loadPage({ reset: true }), loadSelection()]).finally(() => schedulePoll());
}
