(function startPinterestInboxCollector() {
  "use strict";

  if (document.getElementById("pinterest-inbox-extension-root")) return;
  const shared = globalThis.PinterestInboxShared;
  const selected = new Map();
  let enabled = true;
  let mode = "quick";
  let downloadQuality = shared.DEFAULT_DOWNLOAD_QUALITY;
  let currentJobId = null;
  // UI group of jobs already submitted to the existing serial background queue.
  const currentJobs = new Map();
  let cancellingQueue = false;
  let submissionError = "";
  let scanningBoard = false;
  let abortBoardScan = false;
  let qualityTouched = false;
  let jobNotice = "";

  const root = document.createElement("div");
  root.id = "pinterest-inbox-extension-root";
  root.style.cssText = "position:fixed;right:14px;top:78px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{--paper:#faf9f6;--surface:#fff;--ink:#242522;--muted:#797b74;--line:#e7e7e0;--soft:#efefe8;--red:#d91c3b;--tint:#fcecef;color-scheme:light}
      *{box-sizing:border-box}[hidden],.hidden{display:none!important}
      .panel{width:292px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 96px);overflow-y:auto;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:0 8px 32px #24252220;color:var(--ink);font-size:12px;line-height:1.5}
      .head,.identity,.head-actions,.section-label,.selection-row,.progress-label{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .identity{justify-content:flex-start;min-width:0}.identity>div{min-width:0}.mark{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:50%;background:var(--red);color:#fff;font:700 19px Georgia}
      .title{font-weight:750;font-size:13px;letter-spacing:-.3px}.sub{margin-top:1px;color:var(--muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:145px}
      .head-actions{gap:4px;flex:none}button{font:inherit;font-weight:600;color:inherit;border:1px solid transparent;cursor:pointer;border-radius:9px;background:var(--soft);padding:8px;transition:background-color 150ms,transform 120ms,box-shadow 150ms}
      button:hover:not(:disabled){background:var(--line)}button:active:not(:disabled){transform:scale(.96)}button:disabled{opacity:.42;cursor:default}button:focus-visible{outline:2px solid var(--red);outline-offset:3px}
      .power,.collapse{padding:5px 7px;background:var(--surface);border-color:var(--line);font-size:10px}.power[aria-pressed="false"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}.collapse{width:26px;height:26px;padding:5px}.collapse svg{display:block;width:14px;fill:none;stroke:currentColor;stroke-width:1.8;transition:transform 180ms}.collapsed .collapse svg{transform:rotate(180deg)}
      .body{padding-top:16px;animation:enter 180ms ease-out}.modes,.qualities{display:grid;gap:4px}.modes{grid-template-columns:1fr 1fr;padding:3px;border-radius:11px;background:var(--soft)}.modes button{padding:7px 5px;background:none;color:var(--muted);font-size:11px}.modes button.active{background:var(--surface);color:var(--ink);box-shadow:0 1px 4px #0000000b}
      .hint{margin:8px 1px 14px;font-size:11px;color:var(--muted);line-height:1.65}.section-label{margin:0 1px 7px;color:var(--muted);font-size:10px}.section-label strong{font-weight:650;color:var(--ink)}.qualities{grid-template-columns:repeat(3,1fr)}.qualities button{font-size:10px;padding:8px 3px;background:var(--surface);border-color:var(--line)}.qualities button.active{background:var(--tint);border-color:var(--red);color:var(--red)}
      .quality-detail{margin:7px 1px 14px;color:var(--muted);font-size:10px;min-height:30px}.selection-row{padding:10px 0;border-top:1px solid var(--line);font-size:11px}.selection-row strong{font-variant-numeric:tabular-nums}.text-button{padding:3px 5px;background:none;color:var(--muted);font-size:10px}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.actions button{padding:10px 5px;font-size:11px;background:var(--surface);border-color:var(--line)}.actions .primary{background:var(--red);border-color:var(--red);color:white}.actions .primary:hover:not(:disabled){background:#b91934}
      .progress-area{margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.progress-label{font-size:10px;color:var(--muted)}.progress-label strong{color:var(--ink);font-weight:650}progress{display:block;width:100%;height:5px;margin:9px 0 12px;accent-color:var(--red);border:0;border-radius:6px;overflow:hidden}progress::-webkit-progress-bar{background:var(--soft)}progress::-webkit-progress-value{background:var(--red);transition:width 180ms}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:9px;color:var(--muted)}.stats strong{display:block;color:var(--ink);font-size:17px;font-weight:650;font-variant-numeric:tabular-nums}.stats .failed strong{color:var(--red)}
      .status{margin-top:12px;color:var(--muted);font-size:11px;line-height:1.65;overflow-wrap:anywhere}.status[data-kind="error"]{color:var(--red)}.cancel{width:100%;margin-top:10px;background:var(--tint);color:var(--red);font-size:11px}.destination{margin:13px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:9px;line-height:1.6}.paused .body{padding-top:0}.paused .destination{display:none}
      @keyframes enter{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}button:active:not(:disabled){transform:none}}
      @media(prefers-color-scheme:dark){:host{--paper:#232421;--surface:#2b2d29;--ink:#eeeeea;--muted:#a2a69b;--line:#3f423a;--soft:#32352e;--red:#ff647e;--tint:#422930;color-scheme:dark}.actions .primary{color:#251b1d}}
      @media(max-width:340px){.panel{padding:12px}.title{font-size:12px}.mark{width:26px;height:26px}.head{gap:4px}.sub{max-width:115px}.power{padding:5px}.head-actions{gap:3px}}
    </style>
    <section class="panel" aria-label="Pinterest BoardFlow 下载器">
      <div class="head"><div class="identity"><span class="mark" aria-hidden="true">P</span><div><div class="title">Pinterest BoardFlow</div><div id="qualitySummary" class="sub">智能轻量 · 就绪</div></div></div><div class="head-actions"><button id="toggleEnabled" class="power" aria-pressed="true" aria-label="暂停 Pinterest BoardFlow 采集">暂停</button><button id="collapse" class="collapse" aria-label="收起面板" aria-expanded="true" aria-controls="body" title="收起面板"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button></div></div>
      <div id="body" class="body"><div id="controls">
        <div class="modes" role="group" aria-label="图片选择方式"><button id="quick" class="active" aria-pressed="true">单张下载</button><button id="multi" aria-pressed="false">多选下载</button></div>
        <p id="modeHint" class="hint">连续点击图片加入队列，按顺序下载；⌘ / Ctrl 点击打开原页面。</p>
        <div class="section-label"><strong>保存质量</strong><span>只从原图获取</span></div>
        <div class="qualities" role="group" aria-label="图片保存质量"><button data-quality="original">原图</button><button data-quality="high">JPEG 高清</button><button data-quality="light" class="active">智能轻量</button></div>
        <p id="qualityDetail" class="quality-detail">WebP 原样保留，其他图片仅在体积更小时缩小。</p>
        <div class="selection-row"><span>已选 <strong id="selectionCount">0</strong> 张</span><button id="clearSelected" class="text-button" disabled>清空选择</button></div>
        <div class="actions"><button id="downloadSelected" class="primary" disabled>下载已选</button><button id="downloadBoard">下载整个图版</button></div>
      </div>
      <div id="progressArea" class="progress-area" hidden><div class="progress-label"><strong id="progressPhase">下载中</strong><span id="progressCount">0 / 0</span></div><progress id="progress" max="1" value="0" aria-label="下载处理进度"></progress><div class="stats"><div><strong id="successCount">0</strong>已保存</div><div><strong id="skippedCount">0</strong>已跳过</div><div class="failed"><strong id="failedCount">0</strong>失败</div></div></div>
      <div id="status" class="status" role="status" aria-live="polite">下载后会保存到本地 PinterestInbox。</div>
      <button id="cancel" class="cancel hidden">取消下载队列</button>
      <p class="destination">保存到 Downloads / PinterestInbox<br>Codex 运行时会自动收取到长期素材库。</p>
      </div>
    </section>`;

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
  const clearSelectedButton = shadow.getElementById("clearSelected");
  const progressArea = shadow.getElementById("progressArea");
  const progress = shadow.getElementById("progress");
  const collapseButton = shadow.getElementById("collapse");

  function setStatus(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setBusy(busy) {
    cancelButton.classList.toggle("hidden", !busy);
    boardButton.disabled = busy || !enabled;
    selectedButton.disabled = busy || !enabled || selected.size === 0;
    qualityButtons.forEach((button) => { button.disabled = busy || !enabled; });
    quickButton.disabled = multiButton.disabled = busy || !enabled;
    clearSelectedButton.disabled = busy || !enabled || selected.size === 0;
    panel.setAttribute("aria-busy", String(busy));
  }

  function setQuality(nextQuality, persist = true) {
    downloadQuality = shared.normalizeDownloadQuality(nextQuality);
    qualityButtons.forEach((button) => {
      const active = button.dataset.quality === downloadQuality;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const selectedQuality = shared.DOWNLOAD_QUALITIES[downloadQuality];
    qualitySummary.textContent = `${selectedQuality.label} · 就绪`;
    shadow.getElementById("qualityDetail").textContent = downloadQuality === "light"
      ? "WebP 原样保留，其他图片仅在体积更小时缩小。"
      : downloadQuality === "high" ? "全分辨率 JPEG 90；透明图片保留为 PNG，体积可能增大。" : "保留原始分辨率、文件字节与真实格式。";
    if (persist) {
      qualityTouched = true;
      chrome.storage.local.set({ downloadQuality, downloadQualityVersion: shared.QUALITY_PREFERENCE_VERSION });
    }
  }

  function setMode(nextMode) {
    if (currentJobId || scanningBoard || !enabled) return;
    mode = nextMode;
    quickButton.classList.toggle("active", mode === "quick");
    multiButton.classList.toggle("active", mode === "multi");
    quickButton.setAttribute("aria-pressed", String(mode === "quick"));
    multiButton.setAttribute("aria-pressed", String(mode === "multi"));
    shadow.getElementById("modeHint").textContent = mode === "quick"
      ? "连续点击图片加入队列，按顺序下载；⌘ / Ctrl 点击打开原页面。" : "点击图片勾选，再点击一次可移除；选好后统一下载。";
    if (mode === "quick") {
      clearSelection();
      setStatus("连续单击 Pin 即可加入队列，后台会逐张下载。");
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
    shadow.getElementById("selectionCount").textContent = String(selected.size);
    selectedButton.textContent = selected.size ? `下载已选 ${selected.size} 张` : "下载已选";
    selectedButton.disabled = !enabled || selected.size === 0 || Boolean(currentJobId) || scanningBoard;
    clearSelectedButton.disabled = selectedButton.disabled;
  }

  function refreshSelectionMarks() {
    for (const anchor of document.querySelectorAll('a[href*="/pin/"],a[data-pinterest-inbox-selected]')) {
      if (selected.has(selectedKey(anchor))) anchor.setAttribute("data-pinterest-inbox-selected", "true");
      else anchor.removeAttribute("data-pinterest-inbox-selected");
    }
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll('[data-pinterest-inbox-selected="true"]').forEach((element) => element.removeAttribute("data-pinterest-inbox-selected"));
    refreshSelectedUi();
  }

  const pageStyle = document.createElement("style");
  pageStyle.textContent = `a[data-pinterest-inbox-selected="true"]{outline:4px solid #e60023!important;outline-offset:2px!important;border-radius:18px!important}html[data-pinterest-inbox-enabled="true"] a[href*="/pin/"]:hover{cursor:copy}`;

  function ensureMounted() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;
    // Keep extension UI outside Pinterest's application root, in valid HTML containers.
    // Reuse the same nodes after hydration/SPA replacement to retain all UI/job state.
    if (root.parentNode !== body) body.append(root);
    const styleParent = document.head || html;
    if (pageStyle.parentNode !== styleParent) styleParent.append(pageStyle);
    if (html.getAttribute("data-pinterest-inbox-enabled") !== String(enabled)) {
      html.setAttribute("data-pinterest-inbox-enabled", String(enabled));
    }
  }

  let markFrame = null;
  new MutationObserver(() => {
    ensureMounted();
    if (!selected.size || markFrame !== null) return;
    markFrame = requestAnimationFrame(() => { markFrame = null; refreshSelectionMarks(); });
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "data-pinterest-inbox-enabled"] });
  ensureMounted();

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

  async function enqueueAssets(assets, skipped = 0, clearAcceptedSelection = false, notice = "", appendToQueue = false) {
    if (!enabled) return;
    if (scanningBoard || cancellingQueue || (currentJobId && !(appendToQueue && mode === "quick"))) {
      setStatus(cancellingQueue ? "正在取消队列，请结束后再添加图片。" : "当前任务仍在处理，请完成或取消后再下载。"); return;
    }
    if (assets.length === 0) {
      setStatus(skipped ? `没有可下载的静态图片，已跳过 ${skipped} 项。` : "没有找到可下载的 Pin。"); return;
    }
    if (appendToQueue && currentJobId) {
      const pendingKeys = new Set([...currentJobs.values()].filter(job => !job.acknowledged || job.status.pending > 0).flatMap(job => job.assetKeys));
      assets = assets.filter(asset => !pendingKeys.has(`${asset.boardSlug}/${asset.pinId}`));
      if (!assets.length) { setStatus("这张图片已在下载队列中，无需重复点击。"); return; }
    }
    const jobId = newJobId();
    if (!currentJobId) {
      currentJobs.clear();
      currentJobId = jobId;
      jobNotice = notice;
      submissionError = "";
    }
    const entry = {
      acknowledged: false, cancelling: false,
      assetKeys: assets.map(asset => `${asset.boardSlug}/${asset.pinId}`),
      status: { jobId, total: assets.length + skipped, pending: assets.length, success: 0, skipped, failed: 0, originalUnavailable: 0, processingFailed: 0, cancelled: false, done: false }
    };
    currentJobs.set(jobId, entry);
    renderQueueProgress();
    try {
      const response = await sendMessage({ type: "pinterestInboxEnqueue", jobId, assets, skipped, quality: downloadQuality });
      if (currentJobs.get(jobId) !== entry) return;
      if (!response?.ok || response.status?.jobId !== jobId) throw new Error(response?.error || "未收到下载队列确认，请重试");
      entry.acknowledged = true;
      if (clearAcceptedSelection) {
        for (const asset of assets) if (selected.get(asset.pinId) === asset) selected.delete(asset.pinId);
        refreshSelectionMarks(); refreshSelectedUi();
      }
      renderProgress(response.status);
      if (cancellingQueue && entry.status.pending) await cancelQueueEntry(entry);
    } catch (error) {
      if (currentJobs.get(jobId) !== entry) return;
      entry.acknowledged = true;
      // Submission failure affects this request only; other queued downloads continue.
      entry.status = { ...entry.status, pending: 0, failed: assets.length, done: true };
      submissionError = `无法启动下载：${error.message}。未加入的图片可重试${clearAcceptedSelection ? "，已选图片仍保留" : ""}。`;
      renderQueueProgress();
    }
  }

  async function cancelQueueEntry(entry) {
    if (!entry.acknowledged || !entry.status.pending || entry.cancelling) return;
    entry.cancelling = true;
    const jobId = entry.status.jobId;
    try {
      const response = await sendMessage({ type: "pinterestInboxCancel", jobId });
      if (currentJobs.get(jobId) !== entry) return;
      if (!response?.ok || response.status?.jobId !== jobId) throw new Error("未收到取消确认，请重试");
      renderProgress(response.status);
    } catch (error) {
      if (currentJobs.get(jobId) === entry && currentJobId) setStatus(`取消失败：${error.message}。可再次点击“取消下载队列”。`, "error");
    } finally {
      entry.cancelling = false;
    }
  }

  async function cancelCurrentQueue() {
    if (!currentJobId) return;
    cancellingQueue = true;
    renderQueueProgress();
    // Unacknowledged requests are cancelled as soon as their enqueue reply arrives.
    await Promise.all([...currentJobs.values()].map(cancelQueueEntry));
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
    if (scanningBoard || (currentJobId && mode !== "quick")) { setStatus("当前任务仍在处理；⌘ / Ctrl 点击可正常打开图片。"); return; }
    if (!asset) {
      setStatus(`${reason}，已跳过。`);
      return;
    }
    if (mode === "quick") {
      void enqueueAssets([asset], 0, false, "", true);
      return;
    }
    const key = selectedKey(anchor);
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.set(key, asset);
    }
    refreshSelectedUi();
    refreshSelectionMarks();
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
    if (!enabled || currentJobId || scanningBoard) return;
    if (shared.boardSlugFromUrl(location.href) === "unsorted") {
      setStatus("请先打开一个具体 Pinterest 图版，再使用整板下载。");
      return;
    }
    scanningBoard = true;
    abortBoardScan = false;
    setBusy(true);
    const originalScrollY = window.scrollY;
    const originalPath = location.pathname;
    const assets = new Map();
    const skippedKeys = new Set();
    let stableRounds = 0;
    let previousHeight = 0;
    let reachedSafetyLimit = true;
    progressArea.hidden = false;
    progress.removeAttribute("value");
    shadow.getElementById("progressPhase").textContent = "扫描图版";
    for (const id of ["successCount", "skippedCount", "failedCount"]) shadow.getElementById(id).textContent = "0";
    try { for (let step = 0; step < 1000; step += 1) {
      if (abortBoardScan || location.pathname !== originalPath) break;
      const added = collectVisiblePins(assets, skippedKeys);
      const height = document.documentElement.scrollHeight;
      const nearBottom = window.scrollY + window.innerHeight >= height - 32;
      stableRounds = added === 0 && height === previousHeight && nearBottom ? stableRounds + 1 : 0;
      setStatus(`正在扫描图版：发现 ${assets.size} 张，跳过 ${skippedKeys.size} 项…`);
      shadow.getElementById("progressCount").textContent = `发现 ${assets.size} 张`;
      qualitySummary.textContent = `扫描中 · ${assets.size} 张`;
      if (stableRounds >= 5) {
        reachedSafetyLimit = false;
        break;
      }
      previousHeight = height;
      window.scrollTo({ top: Math.min(window.scrollY + Math.max(640, window.innerHeight * 0.85), height), behavior: "auto" });
      await new Promise((resolve) => setTimeout(resolve, 700));
    } } catch (error) {
      abortBoardScan = true;
      setStatus(`扫描未完成：${error.message}`, "error");
      return;
    } finally {
      if (location.pathname === originalPath) window.scrollTo({ top: originalScrollY, behavior: "auto" });
      scanningBoard = false;
      setBusy(Boolean(currentJobId));
      progressArea.hidden = true;
    }
    if (abortBoardScan || location.pathname !== originalPath) {
      qualitySummary.textContent = enabled ? "扫描已停止" : "采集已暂停";
      setStatus(location.pathname !== originalPath ? "页面已切换，整板扫描已停止，未开始下载。"
        : enabled ? `已取消整板扫描；已发现 ${assets.size} 张，未开始下载。` : "采集已暂停，Pin 点击已恢复 Pinterest 原本行为。");
      return;
    }
    await enqueueAssets([...assets.values()], skippedKeys.size, false, reachedSafetyLimit ? "已达到扫描上限，本次仅处理已发现的图片。" : "");
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
    void enqueueAssets(assets, 0, true);
  });
  clearSelectedButton.addEventListener("click", () => {
    if (currentJobId || scanningBoard) return;
    clearSelection(); setStatus("已清空选择。");
  });
  collapseButton.addEventListener("click", () => {
    const body = shadow.getElementById("body");
    body.hidden = !body.hidden;
    panel.classList.toggle("collapsed", body.hidden);
    collapseButton.setAttribute("aria-expanded", String(!body.hidden));
    const label = body.hidden ? "展开面板" : "收起面板";
    collapseButton.setAttribute("aria-label", label); collapseButton.title = label;
  });
  boardButton.addEventListener("click", () => void collectWholeBoard());
  toggleEnabledButton.addEventListener("click", async () => {
    enabled = !enabled;
    panel.classList.toggle("paused", !enabled);
    controls.hidden = !enabled;
    toggleEnabledButton.textContent = enabled ? "暂停" : "启用";
    toggleEnabledButton.setAttribute("aria-pressed", String(enabled));
    toggleEnabledButton.setAttribute("aria-label", enabled ? "暂停 Pinterest BoardFlow 采集" : "启用 Pinterest BoardFlow 采集");
    document.documentElement.setAttribute("data-pinterest-inbox-enabled", String(enabled));
    if (enabled) {
      setBusy(scanningBoard || Boolean(currentJobId));
      qualitySummary.textContent = scanningBoard ? "正在停止扫描" : currentJobId ? "正在结束原任务" : `${shared.DOWNLOAD_QUALITIES[downloadQuality].label} · 就绪`;
      if (scanningBoard) setStatus("正在停止上一次整板扫描…");
      else if (currentJobId) setStatus("采集已启用，正在等待原下载任务结束…");
      else setStatus(mode === "quick" ? `采集已启用。当前使用“${shared.DOWNLOAD_QUALITIES[downloadQuality].label}”质量。` : "采集已启用。单击 Pin 进行勾选。");
      return;
    }
    abortBoardScan = true;
    clearSelection();
    const jobId = currentJobId;
    setBusy(scanningBoard || Boolean(currentJobId));
    qualitySummary.textContent = "采集已暂停";
    setStatus("采集已暂停，Pin 点击已恢复 Pinterest 原本行为。");
    if (jobId) await cancelCurrentQueue();
  });
  cancelButton.addEventListener("click", async () => {
    if (scanningBoard) {
      abortBoardScan = true;
      setStatus("正在停止整板扫描…");
      return;
    }
    await cancelCurrentQueue();
  });

  function renderProgress(value) {
    const entry = currentJobs.get(value.jobId);
    if (!entry || !currentJobId) return;
    // Enqueue/cancel replies can arrive after a newer progress event.
    if (value.pending <= entry.status.pending && !(entry.status.cancelled && !value.cancelled)) {
      entry.status = value;
    }
    renderQueueProgress();
  }

  function renderQueueProgress() {
    const entries = [...currentJobs.values()];
    const value = {total: 0, pending: 0, success: 0, skipped: 0, failed: 0, originalUnavailable: 0, processingFailed: 0, cancelled: cancellingQueue};
    for (const entry of entries) {
      for (const key of ["total", "pending", "success", "skipped", "failed", "originalUnavailable", "processingFailed"]) value[key] += entry.status[key] || 0;
      value.cancelled ||= entry.status.cancelled;
      if (entry.status.lastError) value.lastError = entry.status.lastError;
    }
    const submitting = entries.some(entry => !entry.acknowledged);
    value.done = value.pending === 0 && !submitting;
    const unavailable = value.originalUnavailable ? `（无可用原图 ${value.originalUnavailable}）` : "";
    const processingFailed = value.processingFailed ? `（处理失败 ${value.processingFailed}）` : "";
    const recentError = value.lastError ? ` · ${value.lastError}` : "";
    progressArea.hidden = false;
    progress.max = Math.max(1, value.total);
    progress.value = Math.max(0, value.total - value.pending);
    shadow.getElementById("progressCount").textContent = `${value.total - value.pending} / ${value.total}`;
    const phase = value.cancelled ? value.done ? "已取消" : "取消中" : value.done ? value.failed ? "部分失败" : "处理完成" : submitting ? "加入队列中" : "下载中";
    shadow.getElementById("progressPhase").textContent = phase;
    for (const [id, count] of [["successCount", value.success], ["skippedCount", value.skipped], ["failedCount", value.failed]]) shadow.getElementById(id).textContent = String(count);
    qualitySummary.textContent = value.done ? `${phase} · 已保存 ${value.success} 张` : `${phase} · 待处理 ${value.pending} 张`;
    setStatus(`${jobNotice}${value.pending ? `队列还有 ${value.pending} 张，后台按顺序下载。${mode === "quick" ? "可继续点击图片加入。" : ""}` : ""}跳过 ${value.skipped}${unavailable} · 失败 ${value.failed}${processingFailed}${recentError}`, value.failed ? "error" : "info");
    if (value.done) {
      currentJobId = null;
      cancellingQueue = false;
      setBusy(false);
      if (value.cancelled) setStatus(`任务已取消，已保存的 ${value.success} 张图片仍保留。`);
      else if (!value.failed && !value.skipped) setStatus(`${jobNotice}已保存 ${value.success} 张图片到 PinterestInbox。`);
    } else {
      setBusy(true);
      if (value.cancelled) setStatus("正在取消，等待当前下载停止…");
    }
    if (submissionError) setStatus(`${value.pending ? `队列还有 ${value.pending} 张待处理。` : ""}${submissionError}`, "error");
    if (!enabled) setStatus(value.done ? "采集已暂停，Pin 点击已恢复 Pinterest 原本行为。" : "采集已暂停，正在停止原下载任务…");
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "pinterestInboxDownloadProgress" || !currentJobs.has(message.status?.jobId)) return;
    renderProgress(message.status);
  });

  chrome.storage.local.get(["downloadQuality", "downloadQualityVersion"], (values) => {
    if (qualityTouched) return;
    values = values ?? {};
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
