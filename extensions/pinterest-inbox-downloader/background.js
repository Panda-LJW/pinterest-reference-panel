importScripts("shared.js");

const {
  buildDownloadFilename,
  isPinterestImageUrl,
  originalExtensionForContentType,
  originalImageCandidates
} = globalThis.PinterestInboxShared;
const queue = [];
const jobs = new Map();
const waiters = new Map();
const desiredFilenames = new Map();
let activeItem = null;
let running = false;

function sendToTab(tabId, payload) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, payload, () => void chrome.runtime.lastError);
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    total: job.total,
    success: job.success,
    skipped: job.skipped,
    originalUnavailable: job.originalUnavailable,
    failed: job.failed,
    pending: job.pending,
    cancelled: job.cancelled,
    done: job.pending === 0
  };
}

function report(job) {
  sendToTab(job.tabId, { type: "pinterestInboxDownloadProgress", status: publicJob(job) });
}

function startDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error || !Number.isInteger(downloadId)) reject(new Error(error?.message ?? "Chrome 未返回下载 ID"));
      else resolve(downloadId);
    });
  });
}

function findDownload(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id: downloadId }, (items) => resolve(items?.[0] ?? null));
  });
}

function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      waiters.delete(downloadId);
      const item = await findDownload(downloadId);
      resolve(item?.state === "complete" ? "complete" : "interrupted");
    }, 5 * 60 * 1000);
    waiters.set(downloadId, (state) => {
      clearTimeout(timeout);
      resolve(state);
    });
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state !== "complete" && state !== "interrupted") return;
  const resolve = waiters.get(delta.id);
  if (!resolve) return;
  waiters.delete(delta.id);
  resolve(state);
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }
  const exactFilename = desiredFilenames.get(item.url);
  const sequentialFallback = desiredFilenames.size === 1 ? desiredFilenames.values().next().value : null;
  const filename = exactFilename ?? sequentialFallback;
  if (!filename) {
    suggest();
    return;
  }
  suggest({ filename, conflictAction: "overwrite" });
});

async function runItem(item, job) {
  const original = await resolveOriginalAsset(item.asset);
  if (!original) return "unsupported";
  const filename = buildDownloadFilename(item.asset, original.extension);
  desiredFilenames.set(original.url, filename);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (job.cancelled) return "cancelled";
      try {
        const downloadId = await startDownload({
          url: original.url,
          filename,
          conflictAction: "overwrite",
          saveAs: false
        });
        activeItem = { ...item, downloadId };
        const state = await waitForDownload(downloadId);
        activeItem = null;
        if (state === "complete") return "complete";
      } catch {
        activeItem = null;
      }
    }
    return job.cancelled ? "cancelled" : "failed";
  } finally {
    desiredFilenames.delete(original.url);
  }
}

async function probeOriginal(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const resolvedUrl = response.url || url;
    const extension = originalExtensionForContentType(response.headers.get("content-type"));
    if (!extension || !isPinterestImageUrl(resolvedUrl)) return null;
    return { url: resolvedUrl, extension };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveOriginalAsset(asset) {
  const candidates = originalImageCandidates(asset.imageUrl);
  const results = await Promise.all(candidates.map((candidate) => probeOriginal(candidate)));
  let webpFallback = null;
  for (const result of results) {
    if (!result) continue;
    if (result.extension === ".webp") {
      webpFallback ??= result;
      continue;
    }
    return result;
  }
  return webpFallback;
}

async function pumpQueue() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const item = queue.shift();
    const job = jobs.get(item.jobId);
    if (!job || job.cancelled) continue;
    const result = await runItem(item, job);
    if (result === "complete") job.success += 1;
    else if (result === "failed") job.failed += 1;
    else {
      job.skipped += 1;
      if (result === "unsupported") job.originalUnavailable += 1;
    }
    job.pending = Math.max(0, job.pending - 1);
    report(job);
    if (!job.cancelled && queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 450));
  }
  running = false;
}

function validAsset(asset) {
  return asset && typeof asset.pinId === "string" && typeof asset.boardSlug === "string" && typeof asset.title === "string" && isPinterestImageUrl(asset.imageUrl);
}

function enqueue(message, tabId) {
  const jobId = String(message.jobId || crypto.randomUUID());
  const uniqueAssets = new Map();
  let skipped = Number.isInteger(message.skipped) && message.skipped > 0 ? message.skipped : 0;
  for (const asset of Array.isArray(message.assets) ? message.assets : []) {
    if (!validAsset(asset)) {
      skipped += 1;
      continue;
    }
    const assetKey = `${asset.boardSlug}/${asset.pinId}`;
    if (uniqueAssets.has(assetKey)) skipped += 1;
    else uniqueAssets.set(assetKey, asset);
  }
  const job = {
    jobId,
    tabId,
    total: uniqueAssets.size + skipped,
    success: 0,
    skipped,
    originalUnavailable: 0,
    failed: 0,
    pending: uniqueAssets.size,
    cancelled: false
  };
  jobs.set(jobId, job);
  for (const asset of uniqueAssets.values()) queue.push({ jobId, asset });
  report(job);
  void pumpQueue();
  return publicJob(job);
}

function cancelJob(jobId) {
  const job = jobs.get(String(jobId));
  if (!job) return null;
  job.cancelled = true;
  let removed = 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].jobId !== job.jobId) continue;
    queue.splice(index, 1);
    removed += 1;
  }
  job.pending = Math.max(0, job.pending - removed);
  job.skipped += removed;
  if (activeItem?.jobId === job.jobId && Number.isInteger(activeItem.downloadId)) {
    chrome.downloads.cancel(activeItem.downloadId, () => void chrome.runtime.lastError);
  }
  report(job);
  return publicJob(job);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pinterestInboxEnqueue") {
    sendResponse({ ok: true, status: enqueue(message, sender.tab?.id) });
    return false;
  }
  if (message?.type === "pinterestInboxCancel") {
    sendResponse({ ok: true, status: cancelJob(message.jobId) });
    return false;
  }
  return false;
});
