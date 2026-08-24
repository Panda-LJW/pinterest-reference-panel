(function startPinterestInboxCollector() {
  "use strict";

  if (document.getElementById("pinterest-inbox-extension-root")) return;
  const shared = globalThis.PinterestInboxShared;
  const selected = new Map();
  let enabled = true;
  let mode = "quick";
  let downloadQuality = shared.DEFAULT_DOWNLOAD_QUALITY;
  let currentJobId = null;
  let scanningBoard = false;
  let abortBoardScan = false;

  const root = document.createElement("div");
  root.id = "pinterest-inbox-extension-root";
  root.style.cssText = "position:fixed;right:18px;top:78px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box} .panel{width:248px;padding:12px;border:1px solid rgba(17,17,17,.12);border-radius:18px;background:rgba(255,255,255,.96);box-shadow:0 12px 36px rgba(0,0,0,.15);backdrop-filter:blur(18px);color:#161616}
      [hidden]{display:none!important}.head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:10px}.identity{display:flex;align-items:center;gap:9px;min-width:0}.mark{display:grid;place-items:center;width:30px;height:30px;flex:0 0 auto;border-radius:50%;background:#e60023;color:white;font:700 18px Georgia}.title{font-weight:750;font-size:14px}.sub{margin-top:1px;overflow:hidden;color:#777;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      .modes,.actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.actions{margin-top:7px}.quality-label{display:flex;align-items:center;justify-content:space-between;margin:10px 1px 6px;color:#777;font-size:10px}.qualities{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.qualities button{padding:7px 4px;font-size:11px}.qualities button.active{background:#fff0f2;color:#bd001d;box-shadow:inset 0 0 0 1px #e60023}.wide{grid-column:1/-1}button{border:0;border-radius:11px;padding:8px 9px;background:#f1f1f1;color:#222;font:650 12px inherit;cursor:pointer}button:hover{background:#e7e7e7}button.active{background:#111;color:#fff}button.primary{background:#e60023;color:#fff}button:disabled{cursor:not-allowed;opacity:.45}
      .power{flex:0 0 auto;padding:6px 9px;border:1px solid #dedede;background:#fff;color:#666;font-size:11px}.power:hover{background:#f5f5f5}.power[aria-pressed="false"]{border-color:#111;background:#111;color:#fff}.status{min-height:32px;margin-top:9px;padding:8px 9px;border-radius:10px;background:#f7f7f7;color:#595959;font-size:11px;line-height:1.45}.panel.paused .status{background:#f3f3f3;color:#777}.cancel{margin-top:7px;width:100%;background:#fff0f1;color:#b6001b}.hidden{display:none}
    </style>
    <section class="panel" aria-label="Pinterest Inbox 下载器">
      <div class="head"><div class="identity"><span class="mark">P</span><div><div class="title">Pinterest Inbox</div><div id="qualitySummary" class="sub">智能轻量 · WebP 原样保留</div></div></div><button id="toggleEnabled" class="power" aria-pressed="true" aria-label="暂停 Pinterest Inbox 采集">暂停</button></div>
      <div id="controls"><div class="modes"><button id="quick" class="active">单张模式</button><button id="multi">多选模式</button></div>
      <div class="quality-label"><span>保存质量</span><span>WebP 原样保留</span></div><div class="qualities" role="group" aria-label="图片保存质量"><button data-quality="original">原图</button><button data-quality="high">JPEG 高清</button><button data-quality="light" class="active">智能轻量</button></div>
      <div class="actions"><button id="downloadSelected" disabled>下载已选（0）</button><button id="downloadBoard" class="primary">整板下载</button></div></div>
      <div id="status" class="status">单击 Pin 即可下载静态图片。</div>
      <button id="cancel" class="cancel hidden">取消当前任务</button>
    </section>`;
  document.documentElement.append(root);

  const quickButton = shadow.getElementById("quick");
  const multiButton = shadow.getElementById("multi");
  const selectedButton = shadow.getElementById("downloadSelected");
  const boardButton = shadow.getElementById("downloadBoard");
  const cancelButton = shadow.getElementById("cancel");
  const status = shadow.getElementById("status");
  const panel = shadow.querySelector(".panel");
  const controls = shadow.getElementById("controls");
  const toggleEnabledButton = shadow.getElementById("toggleEnabled");
  const qualitySummary = shadow.getElementById("qualitySummary");
  const qualityButtons = [...shadow.querySelectorAll("[data-quality]")];

  function setStatus(text) {
    status.textContent = text;
  }

  function setBusy(busy) {
    cancelButton.classList.toggle("hidden", !busy);
    boardButton.disabled = busy || !enabled;
    selectedButton.disabled = busy || !enabled || selected.size === 0;
    qualityButtons.forEach((button) => { button.disabled = busy || !enabled; });
  }

  function setQuality(nextQuality, persist = true) {
    downloadQuality = shared.normalizeDownloadQuality(nextQuality);
    qualityButtons.forEach((button) => {
      const active = button.dataset.quality === downloadQuality;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const selectedQuality = shared.DOWNLOAD_QUALITIES[downloadQuality];
    qualitySummary.textContent = `${selectedQuality.label} · ${selectedQuality.description}`;
    if (persist) chrome.storage.local.set({ downloadQuality, downloadQualityVersion: shared.QUALITY_PREFERENCE_VERSION });
  }

  function setMode(nextMode) {
    mode = nextMode;
    quickButton.classList.toggle("active", mode === "quick");
    multiButton.classList.toggle("active", mode === "multi");
    if (mode === "quick") {
      clearSelection();
      setStatus("单击 Pin 即可下载静态图片。");
    } else {
      setStatus("单击 Pin 进行勾选，然后点击“下载已选”。");
    }
  }

  function bestImageUrl(image) {
    const candidates = [shared.bestSrcsetUrl(image.getAttribute("srcset")), image.currentSrc, image.src].filter(Boolean);
    return candidates.find(shared.isPinterestImageUrl) ?? null;
  }

  function assetFromAnchor(anchor) {
    const pinId = shared.parsePinId(anchor.href);
    if (!pinId) return { asset: null, reason: "无 Pin ID" };
    const card = anchor.closest('[data-test-id="pin"]') ?? anchor.parentElement ?? anchor;
    if (card.querySelector("video")) return { asset: null, reason: "视频 Pin" };
    const image = anchor.querySelector("img") ?? card.querySelector("img");
    const imageUrl = image ? bestImageUrl(image) : null;
    if (!imageUrl) return { asset: null, reason: "无静态图片" };
    const title = titleFromCard(card, image, pinId);
    return {
      asset: {
        pinId,
        boardSlug: shared.boardSlugFromUrl(location.href),
        title,
        imageUrl
      },
      reason: null
    };
  }

  function selectedKey(anchor) {
    return shared.parsePinId(anchor.href);
  }

  function titleFromCard(card, image, pinId) {
    const structuredTitle = card.querySelector('[data-test-id="pinrep-footer-organic-title"]')?.textContent
      || card.querySelector('[data-test-id="pinrep-footer"] h2')?.textContent
      || card.querySelector("h2")?.textContent;
    const firstVisibleLine = card.innerText?.split("\n").map((line) => line.trim()).find(Boolean);
    return shared.cleanPinTitle(structuredTitle || firstVisibleLine || image.getAttribute("alt"), `pin-${pinId}`);
  }

  function refreshSelectedUi() {
    selectedButton.textContent = `下载已选（${selected.size}）`;
    selectedButton.disabled = !enabled || selected.size === 0 || Boolean(currentJobId) || scanningBoard;
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll('[data-pinterest-inbox-selected="true"]').forEach((element) => element.removeAttribute("data-pinterest-inbox-selected"));
    refreshSelectedUi();
  }

  const pageStyle = document.createElement("style");
  pageStyle.textContent = `a[data-pinterest-inbox-selected="true"]{outline:4px solid #e60023!important;outline-offset:2px!important;border-radius:18px!important}html[data-pinterest-inbox-enabled="true"] a[href*="/pin/"]:hover{cursor:copy}`;
  document.documentElement.append(pageStyle);
  document.documentElement.setAttribute("data-pinterest-inbox-enabled", "true");

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function newJobId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function enqueueAssets(assets, skipped = 0) {
    if (!enabled) return;
    if (assets.length === 0) {
      setStatus(skipped ? `没有可下载的静态图片，已跳过 ${skipped} 项。` : "没有找到可下载的 Pin。");
      return;
    }
    currentJobId = newJobId();
    setBusy(true);
    setStatus(`已加入队列：${assets.length} 张，跳过 ${skipped} 项。`);
    try {
      await sendMessage({ type: "pinterestInboxEnqueue", jobId: currentJobId, assets, skipped, quality: downloadQuality });
    } catch (error) {
      currentJobId = null;
      setBusy(false);
      setStatus(`无法启动下载：${error.message}`);
    }
  }

  document.addEventListener("click", (event) => {
    if (!enabled) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('a[href*="/pin/"]');
    if (!anchor || root.contains(target)) return;
    const { asset, reason } = assetFromAnchor(anchor);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!asset) {
      setStatus(`${reason}，已跳过。`);
      return;
    }
    if (mode === "quick") {
      if (!currentJobId) void enqueueAssets([asset]);
      return;
    }
    const key = selectedKey(anchor);
    if (selected.has(key)) {
      selected.delete(key);
      anchor.removeAttribute("data-pinterest-inbox-selected");
    } else {
      selected.set(key, asset);
      anchor.setAttribute("data-pinterest-inbox-selected", "true");
    }
    refreshSelectedUi();
    setStatus(`已选择 ${selected.size} 张静态图片。`);
  }, true);

  function collectVisiblePins(assets, skippedKeys) {
    let added = 0;
    for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
      const key = selectedKey(anchor) ?? anchor.href;
      if (assets.has(key) || skippedKeys.has(key)) continue;
      const result = assetFromAnchor(anchor);
      if (result.asset) {
        assets.set(key, result.asset);
        added += 1;
      } else {
        skippedKeys.add(key);
      }
    }
    return added;
  }

  async function collectWholeBoard() {
    if (shared.boardSlugFromUrl(location.href) === "unsorted") {
      setStatus("请先打开一个具体 Pinterest 图版，再使用整板下载。");
      return;
    }
    scanningBoard = true;
    abortBoardScan = false;
    setBusy(true);
    const originalScrollY = window.scrollY;
    const assets = new Map();
    const skippedKeys = new Set();
    let stableRounds = 0;
    let previousHeight = 0;
    let reachedSafetyLimit = true;
    for (let step = 0; step < 1000; step += 1) {
      if (abortBoardScan) break;
      const added = collectVisiblePins(assets, skippedKeys);
      const height = document.documentElement.scrollHeight;
      const nearBottom = window.scrollY + window.innerHeight >= height - 32;
      stableRounds = added === 0 && height === previousHeight && nearBottom ? stableRounds + 1 : 0;
      setStatus(`正在扫描图版：发现 ${assets.size} 张，跳过 ${skippedKeys.size} 项…`);
      if (stableRounds >= 5) {
        reachedSafetyLimit = false;
        break;
      }
      previousHeight = height;
      window.scrollTo({ top: Math.min(window.scrollY + Math.max(640, window.innerHeight * 0.85), height), behavior: "auto" });
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    window.scrollTo({ top: originalScrollY, behavior: "auto" });
    scanningBoard = false;
    if (abortBoardScan) {
      setBusy(false);
      setStatus(enabled ? `已取消整板扫描；已发现 ${assets.size} 张，未开始下载。` : "采集已暂停，Pin 点击已恢复 Pinterest 原本行为。");
      return;
    }
    if (reachedSafetyLimit) {
      setStatus(`页面持续加载，已在安全上限停止；将下载已发现的 ${assets.size} 张。`);
    }
    await enqueueAssets([...assets.values()], skippedKeys.size);
  }

  quickButton.addEventListener("click", () => setMode("quick"));
  multiButton.addEventListener("click", () => setMode("multi"));
  qualityButtons.forEach((button) => button.addEventListener("click", () => {
    if (currentJobId || scanningBoard) return;
    setQuality(button.dataset.quality);
    const selectedQuality = shared.DOWNLOAD_QUALITIES[downloadQuality];
    setStatus(`保存质量已切换为“${selectedQuality.label}”：${selectedQuality.description}。`);
  }));
  selectedButton.addEventListener("click", () => {
    const assets = [...selected.values()];
    clearSelection();
    void enqueueAssets(assets);
  });
  boardButton.addEventListener("click", () => void collectWholeBoard());
  toggleEnabledButton.addEventListener("click", async () => {
    enabled = !enabled;
    panel.classList.toggle("paused", !enabled);
    controls.hidden = !enabled;
    toggleEnabledButton.textContent = enabled ? "暂停" : "启用";
    toggleEnabledButton.setAttribute("aria-pressed", String(enabled));
    toggleEnabledButton.setAttribute("aria-label", enabled ? "暂停 Pinterest Inbox 采集" : "启用 Pinterest Inbox 采集");
    document.documentElement.setAttribute("data-pinterest-inbox-enabled", String(enabled));
    if (enabled) {
      setBusy(scanningBoard || Boolean(currentJobId));
      if (scanningBoard) setStatus("正在停止上一次整板扫描…");
      else setStatus(mode === "quick" ? `采集已启用。当前使用“${shared.DOWNLOAD_QUALITIES[downloadQuality].label}”质量。` : "采集已启用。单击 Pin 进行勾选。");
      return;
    }
    abortBoardScan = true;
    clearSelection();
    const jobId = currentJobId;
    currentJobId = null;
    setBusy(false);
    setStatus("采集已暂停，Pin 点击已恢复 Pinterest 原本行为。");
    if (jobId) {
      try {
        await sendMessage({ type: "pinterestInboxCancel", jobId });
      } catch {
        setStatus("采集已暂停；原下载任务可能已在 Chrome 中完成。");
      }
    }
  });
  cancelButton.addEventListener("click", async () => {
    if (scanningBoard) {
      abortBoardScan = true;
      setStatus("正在停止整板扫描…");
      return;
    }
    if (!currentJobId) return;
    try {
      await sendMessage({ type: "pinterestInboxCancel", jobId: currentJobId });
      setStatus("已请求取消当前下载任务。");
    } catch (error) {
      setStatus(`取消失败：${error.message}`);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "pinterestInboxDownloadProgress" || message.status?.jobId !== currentJobId) return;
    const value = message.status;
    const unavailable = value.originalUnavailable ? `（无 originals 原图 ${value.originalUnavailable}）` : "";
    const processingFailed = value.processingFailed ? `（处理失败 ${value.processingFailed}）` : "";
    const recentError = value.lastError ? ` · ${value.lastError}` : "";
    setStatus(`成功 ${value.success} · 跳过 ${value.skipped}${unavailable} · 失败 ${value.failed}${processingFailed} · 待处理 ${value.pending}${recentError}`);
    if (value.done || value.cancelled) {
      currentJobId = null;
      setBusy(false);
      if (value.cancelled) setStatus(`任务已取消。成功 ${value.success} · 跳过 ${value.skipped}${unavailable} · 失败 ${value.failed}`);
      else setStatus(`下载完成。成功 ${value.success} · 跳过 ${value.skipped}${unavailable} · 失败 ${value.failed}${processingFailed}${recentError}`);
    }
  });

  chrome.storage.local.get(["downloadQuality", "downloadQualityVersion"], (values) => {
    const needsMigration = values.downloadQualityVersion !== shared.QUALITY_PREFERENCE_VERSION;
    const nextQuality = needsMigration ? shared.DEFAULT_DOWNLOAD_QUALITY : values.downloadQuality;
    setQuality(nextQuality, false);
    if (needsMigration) {
      chrome.storage.local.set({
        downloadQuality: shared.DEFAULT_DOWNLOAD_QUALITY,
        downloadQualityVersion: shared.QUALITY_PREFERENCE_VERSION
      });
    }
  });
})();
