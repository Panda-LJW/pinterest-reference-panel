const token = document.querySelector('meta[name="pinterest-panel-token"]')?.content ?? "";
const DEFAULT_API_TIMEOUT_MS = 8_000;
const THUMBNAIL_TIMEOUT_MS = 20_000;
const REFRESH_TIMEOUT_MS = 120_000;
const elements = {
  watcherSummary: document.querySelector("#watcherSummary"),
  refreshButton: document.querySelector("#refreshButton"),
  pinsTab: document.querySelector("#pinsTab"),
  boardsTab: document.querySelector("#boardsTab"),
  statusBanner: document.querySelector("#statusBanner"),
  boardFilter: document.querySelector("#boardFilter"),
  content: document.querySelector("#content"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  toast: document.querySelector("#toast")
};

const state = {
  tab: "pins",
  boardId: null,
  boardTitle: null,
  assets: [],
  boards: [],
  total: 0,
  libraryTotal: 0,
  nextCursor: null,
  version: null,
  watcherStatus: "starting",
  transfer: null,
  refreshedAt: null,
  initialLoading: true,
  pageLoading: false,
  pageGeneration: 0,
  refreshing: false,
  offline: false,
  copiedAssetId: null,
  pendingCopies: new Set(),
  thumbnailUrls: new Map(),
  thumbnailFailures: new Set(),
  thumbnailRequests: new Map(),
  thumbnailEpoch: 0,
  thumbnailActive: 0,
  thumbnailWaiters: [],
  pollTimer: null,
  pollDelay: 2000,
  toastTimer: null
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  const headers = new Headers(options.headers ?? {});
  headers.set("X-Pinterest-Panel-Token", token);
  headers.set("Accept", options.expectBlob ? "image/jpeg" : "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    if (!response.ok) {
      let message = `请求失败（${response.status}）`;
      try { message = (await response.json()).error || message; } catch { /* keep status message */ }
      throw new Error(message);
    }
    return options.expectBlob ? response.blob() : response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("本地服务响应超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function clearThumbnailCache() {
  state.thumbnailEpoch += 1;
  for (const url of state.thumbnailUrls.values()) URL.revokeObjectURL(url);
  state.thumbnailUrls.clear();
  state.thumbnailFailures.clear();
}

async function withThumbnailSlot(task) {
  if (state.thumbnailActive >= 4) await new Promise((resolveWait) => state.thumbnailWaiters.push(resolveWait));
  state.thumbnailActive += 1;
  try { return await task(); }
  finally {
    state.thumbnailActive -= 1;
    state.thumbnailWaiters.shift()?.();
  }
}

function thumbnailUrl(assetId) {
  const cached = state.thumbnailUrls.get(assetId);
  if (cached) return Promise.resolve(cached);
  const epoch = state.thumbnailEpoch;
  const requestKey = `${epoch}:${assetId}`;
  const existing = state.thumbnailRequests.get(requestKey);
  if (existing) return existing;
  const pending = withThumbnailSlot(async () => {
    try {
      if (epoch !== state.thumbnailEpoch) throw new Error("thumbnail-generation-changed");
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

function mergeSummary(summary, acceptVersion = true) {
  if (!summary) return;
  if (acceptVersion && Number.isInteger(summary.version)) state.version = summary.version;
  if (summary.watcherStatus) state.watcherStatus = summary.watcherStatus;
  if (summary.transfer) state.transfer = summary.transfer;
  if (summary.refreshedAt) state.refreshedAt = summary.refreshedAt;
}

function updateChrome() {
  let statusText;
  let statusState;
  if (state.offline) {
    statusText = "本地服务已断开 · 正在重连";
    statusState = "offline";
  } else if (state.watcherStatus === "watching") {
    statusText = `正在监听 · ${state.libraryTotal} 张`;
    statusState = "watching";
  } else if (state.watcherStatus === "degraded") {
    statusText = `周期扫描可用 · ${state.libraryTotal} 张`;
    statusState = "degraded";
  } else if (state.watcherStatus === "stopped") {
    statusText = "监听已停止";
    statusState = "stopped";
  } else {
    statusText = "正在连接本地素材库…";
    statusState = "starting";
  }
  elements.watcherSummary.textContent = statusText;
  elements.watcherSummary.dataset.state = statusState;

  elements.pinsTab.classList.toggle("is-active", state.tab === "pins");
  elements.boardsTab.classList.toggle("is-active", state.tab === "boards");
  elements.pinsTab.setAttribute("aria-selected", String(state.tab === "pins"));
  elements.boardsTab.setAttribute("aria-selected", String(state.tab === "boards"));
  elements.refreshButton.disabled = state.refreshing;

  const banner = (() => {
    if (state.offline) return { danger: true, text: "本地网页服务已断开。现有素材仍保留在页面中，服务恢复后会自动重连。" };
    if ((state.transfer?.failed ?? 0) > 0) return { danger: true, text: `有 ${state.transfer.failed} 个下载文件未能安全收取；原文件仍保留在 Downloads 临时区。` };
    if (state.watcherStatus === "degraded") return { danger: false, text: "实时监听暂时异常，10 秒周期扫描仍在运行；也可以点右上角立即刷新。" };
    return null;
  })();
  elements.statusBanner.hidden = !banner;
  elements.statusBanner.classList.toggle("is-danger", Boolean(banner?.danger));
  elements.statusBanner.textContent = banner?.text ?? "";

  elements.boardFilter.hidden = !state.boardId || state.tab !== "pins";
  if (!elements.boardFilter.hidden) {
    elements.boardFilter.replaceChildren();
    const copy = element("div", "board-filter-copy");
    copy.append(element("small", "", "当前图版"), element("strong", "", state.boardTitle ?? state.boardId));
    const clear = element("button", "filter-clear", "显示全部");
    clear.type = "button";
    clear.addEventListener("click", () => {
      state.boardId = null;
      state.boardTitle = null;
      void loadPage({ reset: true });
    });
    elements.boardFilter.append(copy, clear);
  }
}

function emptyState(title, detail) {
  const wrapper = element("section", "empty-state");
  const inner = element("div", "empty-state-inner");
  inner.append(element("div", "empty-mark", "P"), element("h2", "", title), element("p", "", detail));
  wrapper.append(inner);
  return wrapper;
}

function thumbnailImage(assetId, alt = "") {
  const image = document.createElement("img");
  image.alt = alt;
  image.dataset.assetId = assetId;
  image.dataset.thumbnailState = "pending";
  return image;
}

function pinCard(asset) {
  const card = element("button", "pin-card");
  card.type = "button";
  card.dataset.assetId = asset.id;
  card.setAttribute("aria-label", `复制「${asset.title}」的绝对路径`);
  card.classList.toggle("is-copying", state.pendingCopies.has(asset.id));
  card.classList.toggle("is-copied", state.copiedAssetId === asset.id);

  const frame = element("div", "thumb-frame");
  frame.append(thumbnailImage(asset.id, asset.title), element("span", "thumb-skeleton"));
  const action = element("span", "pin-copy", state.pendingCopies.has(asset.id) ? "…" : state.copiedAssetId === asset.id ? "✓" : "+");
  action.setAttribute("aria-hidden", "true");
  frame.append(action);

  const body = element("div", "pin-body");
  body.append(element("p", "pin-title", asset.title));
  const meta = element("div", "pin-meta");
  meta.append(element("span", "", asset.boardTitle), element("span", "", formatBytes(asset.size)));
  body.append(meta);
  card.append(frame, body);
  card.addEventListener("click", () => void copyAsset(asset));
  return card;
}

function boardCard(board) {
  const card = element("button", "board-card");
  card.type = "button";
  card.setAttribute("aria-label", `打开图版 ${board.title}`);
  const covers = element("div", "board-covers");
  const coverIds = board.coverAssetIds.length ? board.coverAssetIds : [""];
  for (let index = 0; index < 3; index += 1) {
    const cover = element("span", "cover");
    const assetId = coverIds[index];
    if (assetId) cover.append(thumbnailImage(assetId));
    covers.append(cover);
  }
  const body = element("div", "board-body");
  body.append(element("strong", "", board.title));
  const meta = element("div", "board-meta");
  meta.append(element("span", "", `${board.pinCount} Pins`), element("span", "", "查看 →"));
  body.append(meta);
  card.append(covers, body);
  card.addEventListener("click", () => {
    state.tab = "pins";
    state.boardId = board.id;
    state.boardTitle = board.title;
    void loadPage({ reset: true });
  });
  return card;
}

function renderContent() {
  updateChrome();
  elements.content.setAttribute("aria-busy", String(state.initialLoading || state.pageLoading));
  if (state.initialLoading) return;

  if (state.offline && !state.assets.length && !state.boards.length) {
    elements.content.replaceChildren(emptyState("无法连接本地素材库", "请重新打开 Pinterest Inbox 插件；页面会在服务恢复后自动重试。"));
    elements.loadMoreButton.hidden = true;
    return;
  }

  if (state.tab === "boards") {
    if (!state.boards.length) {
      elements.content.replaceChildren(emptyState("还没有图版", "从 Pinterest 下载图片后，文件夹会自动成为这里的 Boards。"));
    } else {
      const grid = element("section", "boards-grid");
      for (const board of state.boards) grid.append(boardCard(board));
      elements.content.replaceChildren(grid);
    }
    elements.loadMoreButton.hidden = true;
    void hydrateThumbnails();
    return;
  }

  if (!state.assets.length) {
    const title = state.boardId ? "这个图版还没有图片" : "Pinterest Inbox 还是空的";
    const detail = state.boardId ? "返回全部 Pins，或在 Pinterest 中继续下载参考素材。" : "在 Pinterest 扩展中下载一张图片，它会被安全收取到 Pictures 长期库。";
    elements.content.replaceChildren(emptyState(title, detail));
  } else {
    const masonry = element("section", "masonry");
    for (const asset of state.assets) masonry.append(pinCard(asset));
    elements.content.replaceChildren(masonry);
  }
  elements.loadMoreButton.hidden = !state.nextCursor;
  elements.loadMoreButton.disabled = state.pageLoading;
  void hydrateThumbnails();
}

async function hydrateThumbnails() {
  const images = [...document.querySelectorAll('img[data-thumbnail-state="pending"]')];
  await Promise.allSettled(images.map(async (image) => {
    const assetId = image.dataset.assetId;
    const frame = image.closest(".thumb-frame, .cover");
    if (!assetId || state.thumbnailFailures.has(assetId)) {
      frame?.classList.add("has-error");
      image.dataset.thumbnailState = "error";
      image.remove();
      return;
    }
    try {
      const url = await thumbnailUrl(assetId);
      image.addEventListener("load", () => {
        image.classList.add("is-loaded");
        frame?.querySelector(".thumb-skeleton")?.remove();
      }, { once: true });
      image.src = url;
      image.dataset.thumbnailState = "loaded";
    } catch (error) {
      if (error instanceof Error && error.message === "thumbnail-generation-changed") return;
      state.thumbnailFailures.add(assetId);
      frame?.classList.add("has-error");
      frame?.querySelector(".thumb-skeleton")?.remove();
      image.dataset.thumbnailState = "error";
      image.remove();
    }
  }));
}

async function copyAsset(asset) {
  if (state.pendingCopies.has(asset.id)) return;
  state.pendingCopies.add(asset.id);
  renderContent();
  try {
    await api("/api/clipboard", { method: "POST", body: { assetId: asset.id } });
    state.copiedAssetId = asset.id;
    showToast("绝对路径已复制 · 回到对话按 ⌘V");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "复制失败，请重试", true);
  } finally {
    state.pendingCopies.delete(asset.id);
    renderContent();
  }
}

async function loadPage({ reset = false } = {}) {
  if (!reset && state.pageLoading) return;
  if (reset) state.pageGeneration += 1;
  const generation = state.pageGeneration;
  const requestedTab = state.tab;
  const requestedBoardId = state.boardId;
  const requestedCursor = reset ? null : state.nextCursor;
  const isCurrentRequest = () => generation === state.pageGeneration
    && requestedTab === state.tab
    && requestedBoardId === state.boardId;
  state.pageLoading = true;
  if (reset && state.initialLoading) renderContent();
  try {
    const params = new URLSearchParams({ limit: "30" });
    if (requestedCursor) params.set("cursor", requestedCursor);
    if (requestedBoardId) params.set("boardId", requestedBoardId);
    const result = await api(`/api/inbox?${params}`);
    if (!isCurrentRequest()) return;
    const page = result.page;
    if (state.version !== null && page.version !== state.version) clearThumbnailCache();
    state.assets = reset ? page.assets : [...state.assets, ...page.assets];
    state.boards = page.boards;
    state.total = page.total;
    state.libraryTotal = page.libraryTotal;
    state.nextCursor = page.nextCursor;
    mergeSummary(page);
    state.offline = false;
    state.pollDelay = 2000;
  } catch (error) {
    if (!isCurrentRequest()) return;
    state.offline = true;
    if (!state.assets.length && !state.boards.length) {
      elements.content.replaceChildren(emptyState("无法连接本地素材库", "请重新打开 Pinterest Inbox 插件；页面会在服务恢复后自动重试。"));
    }
    showToast(error instanceof Error ? error.message : "读取素材失败", true);
  } finally {
    if (isCurrentRequest()) {
      state.pageLoading = false;
      state.initialLoading = false;
      renderContent();
    }
  }
}

async function refreshNow() {
  if (state.refreshing) return;
  state.refreshing = true;
  updateChrome();
  try {
    const result = await api("/api/refresh", { method: "POST", body: {}, timeoutMs: REFRESH_TIMEOUT_MS });
    mergeSummary(result, false);
    clearThumbnailCache();
    await loadPage({ reset: true });
    showToast("Pinterest Inbox 已刷新");
  } catch (error) {
    state.offline = true;
    showToast(error instanceof Error ? error.message : "刷新失败", true);
  } finally {
    state.refreshing = false;
    updateChrome();
  }
}

function schedulePoll(delay = state.pollDelay) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => void pollStatus(), delay);
}

async function pollStatus() {
  if (document.hidden) {
    schedulePoll(3000);
    return;
  }
  const knownVersion = state.version;
  try {
    const suffix = Number.isInteger(knownVersion) ? `?knownVersion=${knownVersion}` : "";
    const result = await api(`/api/status${suffix}`);
    mergeSummary(result, false);
    state.offline = false;
    state.pollDelay = 2000;
    updateChrome();
    if (!result.unchanged) await loadPage({ reset: true });
  } catch {
    state.offline = true;
    state.pollDelay = Math.min(10_000, Math.max(2000, state.pollDelay * 2));
    updateChrome();
  } finally {
    schedulePoll();
  }
}

elements.refreshButton.addEventListener("click", () => void refreshNow());
elements.loadMoreButton.addEventListener("click", () => void loadPage());
elements.pinsTab.addEventListener("click", () => {
  state.tab = "pins";
  state.boardId = null;
  state.boardTitle = null;
  void loadPage({ reset: true });
});
elements.boardsTab.addEventListener("click", () => {
  state.tab = "boards";
  state.boardId = null;
  state.boardTitle = null;
  void loadPage({ reset: true });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedulePoll(0);
});
window.addEventListener("beforeunload", () => {
  for (const url of state.thumbnailUrls.values()) URL.revokeObjectURL(url);
});

if (!token) {
  state.initialLoading = false;
  state.offline = true;
  elements.content.replaceChildren(emptyState("本地面板会话无效", "请关闭当前页面后，从 Pinterest Inbox 插件重新打开。"));
  renderContent();
} else {
  void loadPage({ reset: true }).finally(() => schedulePoll());
}
