(function installPinterestInboxShared(target) {
  "use strict";

  const STATIC_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
  const DOWNLOAD_QUALITIES = Object.freeze({
    original: Object.freeze({ id: "original", label: "原图", description: "原始分辨率与格式" }),
    high: Object.freeze({ id: "high", label: "JPEG 高清", description: "全分辨率 JPEG 90" }),
    light: Object.freeze({ id: "light", label: "智能轻量", description: "WebP 原样 · 其他智能缩小" })
  });
  const DEFAULT_DOWNLOAD_QUALITY = "light";
  const QUALITY_PREFERENCE_VERSION = 2;

  function normalizeDownloadQuality(value) {
    return Object.hasOwn(DOWNLOAD_QUALITIES, value) ? value : DEFAULT_DOWNLOAD_QUALITY;
  }

  function safeSegment(value, fallback = "untitled", maxLength = 96) {
    const cleaned = String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, maxLength);
    return cleaned || fallback;
  }

  function parsePinId(value) {
    try {
      const url = new URL(value, "https://www.pinterest.com/");
      const match = url.pathname.match(/\/pin\/([a-zA-Z0-9-]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function cleanPinTitle(value, fallback = "pinterest-image") {
    const withoutAccessibilityPrefix = String(value ?? "")
      .replace(/^其中包括图片\s*[：:]?\s*/u, "")
      .trim();
    return safeSegment(withoutAccessibilityPrefix, fallback, 96);
  }

  function boardSlugFromUrl(value) {
    try {
      const url = new URL(value, "https://www.pinterest.com/");
      const segments = url.pathname.split("/").filter(Boolean);
      const reserved = new Set(["pin", "search", "ideas", "today", "settings"]);
      if (segments.length >= 2 && !reserved.has((segments[0] ?? "").toLowerCase())) {
        return safeSegment(segments[1], "unsorted", 80).toLowerCase().replace(/\s+/g, "-");
      }
      return "unsorted";
    } catch {
      return "unsorted";
    }
  }

  function extensionForUrl(value) {
    try {
      const pathname = new URL(value).pathname.toLowerCase();
      const match = pathname.match(/\.(avif|gif|jpe?g|png|webp)$/);
      return match ? `.${match[1] === "jpeg" ? "jpg" : match[1]}` : ".jpg";
    } catch {
      return ".jpg";
    }
  }

  function originalExtensionForContentType(value) {
    const contentType = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
    if (contentType === "image/jpeg" || contentType === "image/jpg") return ".jpg";
    if (contentType === "image/png") return ".png";
    if (contentType === "image/webp") return ".webp";
    return null;
  }

  function originalImageCandidates(value) {
    if (!isPinterestImageUrl(value)) return [];
    const url = new URL(value);
    const sourceExtension = extensionForUrl(value);
    const stem = url.pathname.replace(/\.(avif|gif|jpe?g|png|webp)$/i, "");
    const pathMatch = stem.match(/^\/(?:\d+x(?:\d+)?(?:_[a-z]+)?|originals)\/(.+)$/i);
    if (!pathMatch) return [];
    const originalStem = `/originals/${pathMatch[1]}`;
    const preferredExtensions = sourceExtension === ".png"
      ? [".png", ".jpg", ".jpeg", ".webp"]
      : [".jpg", ".jpeg", ".png", ".webp"];
    const candidates = preferredExtensions.map((extension) => {
      const candidate = new URL(url.href);
      candidate.pathname = `${originalStem}${extension}`;
      return candidate.href;
    });
    return [...new Set(candidates)];
  }

  function isPinterestImageUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || (host !== "pinimg.com" && !host.endsWith(".pinimg.com"))) return false;
      const extension = extensionForUrl(value);
      return STATIC_EXTENSIONS.has(extension) && !url.pathname.toLowerCase().endsWith(".m3u8");
    } catch {
      return false;
    }
  }

  function bestSrcsetUrl(srcset) {
    if (!srcset) return null;
    const candidates = String(srcset).split(",").map((entry) => {
      const match = entry.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)(w|x)$/);
      return match ? { url: match[1], score: Number(match[2]) } : null;
    }).filter(Boolean).sort((left, right) => right.score - left.score);
    return candidates[0]?.url ?? null;
  }

  function buildDownloadFilename(asset, originalExtension) {
    const board = safeSegment(asset.boardSlug, "unsorted", 80).toLowerCase().replace(/\s+/g, "-");
    const pinId = safeSegment(asset.pinId, "pin", 64);
    const title = safeSegment(asset.title, "pinterest-image", 96);
    if (![".jpg", ".png", ".webp"].includes(originalExtension)) {
      throw new TypeError("下载文件名必须使用已验证的原图格式");
    }
    const extension = originalExtension;
    return `PinterestInbox/${board}/${title}__pin-${pinId}${extension}`;
  }

  target.PinterestInboxShared = Object.freeze({
    DEFAULT_DOWNLOAD_QUALITY,
    DOWNLOAD_QUALITIES,
    QUALITY_PREFERENCE_VERSION,
    bestSrcsetUrl,
    boardSlugFromUrl,
    buildDownloadFilename,
    cleanPinTitle,
    extensionForUrl,
    isPinterestImageUrl,
    originalExtensionForContentType,
    originalImageCandidates,
    normalizeDownloadQuality,
    parsePinId,
    safeSegment
  });
})(globalThis);
