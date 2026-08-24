(function installPinterestInboxShared(target) {
  "use strict";

  const STATIC_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

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

  function buildDownloadFilename(asset) {
    const board = safeSegment(asset.boardSlug, "unsorted", 80).toLowerCase().replace(/\s+/g, "-");
    const pinId = safeSegment(asset.pinId, "pin", 64);
    const title = safeSegment(asset.title, "pinterest-image", 96);
    const extension = extensionForUrl(asset.imageUrl);
    return `PinterestInbox/${board}/${pinId}__${title}${extension}`;
  }

  target.PinterestInboxShared = Object.freeze({
    bestSrcsetUrl,
    boardSlugFromUrl,
    buildDownloadFilename,
    extensionForUrl,
    isPinterestImageUrl,
    parsePinId,
    safeSegment
  });
})(globalThis);
