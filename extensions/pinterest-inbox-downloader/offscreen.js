(function startPinterestInboxImageProcessor() {
  "use strict";

  const objectUrls = new Map();

  function ascii(bytes, offset, length) {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
  }

  async function pngHasAlpha(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 26 || ascii(bytes, 1, 3) !== "PNG") return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = ascii(bytes, offset + 4, 4);
      const dataOffset = offset + 8;
      if (dataOffset + length + 4 > bytes.length) break;
      if (type === "IHDR") {
        const colorType = bytes[dataOffset + 9];
        if (colorType === 4 || colorType === 6) return true;
      }
      if (type === "tRNS") return true;
      if (type === "IEND") break;
      offset = dataOffset + length + 4;
    }
    return false;
  }

  async function webpHasAlpha(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 16 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const length = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
      const dataOffset = offset + 8;
      if (type === "ALPH") return true;
      if (type === "VP8X" && dataOffset < bytes.length && (bytes[dataOffset] & 0x10) !== 0) return true;
      offset = dataOffset + Math.max(0, length) + (length % 2);
    }
    return false;
  }

  async function hasTransparency(blob) {
    if (blob.type === "image/png") return pngHasAlpha(blob);
    if (blob.type === "image/webp") return webpHasAlpha(blob);
    return false;
  }

  function extensionForImageType(type, fallback) {
    if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
    if (type === "image/png") return ".png";
    if (type === "image/webp") return ".webp";
    return [".jpg", ".png", ".webp"].includes(fallback) ? fallback : null;
  }

  function canvasFor(width, height) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function canvasToBlob(canvas, options) {
    if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob(options);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器未能编码图片")), options.type, options.quality);
    });
  }

  async function convertImage(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(message.url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`原图下载失败（HTTP ${response.status}）`);
      const sourceBlob = await response.blob();
      if (!sourceBlob.type.startsWith("image/")) throw new Error("原图响应不是图片");
      const bitmap = await createImageBitmap(sourceBlob);
      try {
        const transparent = await hasTransparency(sourceBlob);
        const maxEdge = message.quality === "light" ? 2048 : Number.POSITIVE_INFINITY;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = canvasFor(width, height);
        const context = canvas.getContext("2d", { alpha: transparent });
        if (!context) throw new Error("浏览器无法创建图片画布");
        if (!transparent) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, 0, 0, width, height);
        const options = transparent
          ? { type: "image/png" }
          : { type: "image/jpeg", quality: message.quality === "light" ? 0.8 : 0.9 };
        const candidateBlob = await canvasToBlob(canvas, options);
        const preserveOriginal = message.quality === "light" && candidateBlob.size >= sourceBlob.size;
        const outputBlob = preserveOriginal ? sourceBlob : candidateBlob;
        const outputExtension = preserveOriginal
          ? extensionForImageType(sourceBlob.type, message.sourceExtension)
          : transparent ? ".png" : ".jpg";
        if (!outputExtension) throw new Error("无法确认智能轻量输出格式");
        const objectUrl = URL.createObjectURL(outputBlob);
        objectUrls.set(message.requestId, objectUrl);
        setTimeout(() => {
          const staleUrl = objectUrls.get(message.requestId);
          if (!staleUrl) return;
          URL.revokeObjectURL(staleUrl);
          objectUrls.delete(message.requestId);
        }, 10 * 60 * 1000);
        return {
          ok: true,
          requestId: message.requestId,
          url: objectUrl,
          extension: outputExtension,
          sourceBytes: sourceBlob.size,
          outputBytes: outputBlob.size,
          candidateBytes: candidateBlob.size,
          width,
          height,
          transparent,
          preservedOriginal: preserveOriginal
        };
      } finally {
        bitmap.close();
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function revoke(requestId) {
    const objectUrl = objectUrls.get(requestId);
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrls.delete(requestId);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "pinterestInboxConvertImage") {
      convertImage(message).then(sendResponse, (error) => sendResponse({
        ok: false,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error)
      }));
      return true;
    }
    if (message?.type === "pinterestInboxRevokeImage") {
      revoke(message.requestId);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
