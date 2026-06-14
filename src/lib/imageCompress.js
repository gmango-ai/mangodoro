// Client-side image compression for avatar uploads.
//
// Modern phone photos are 5–15 MB but a 512px avatar only needs ~80 KB.
// Instead of asking the user to resize first, we decode the image,
// downscale it, and re-encode as JPEG at quality 0.85. Animated GIFs lose
// their animation when drawn to a canvas — acceptable trade-off for a
// profile picture; callers that care can pre-check `file.type === "image/gif"`.
//
// Returns the original file unchanged if it's already small in both
// pixels AND bytes — no point re-encoding a 50 KB PNG.

const DEFAULT_MAX_DIM = 512;
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024; // stay well under the 2 MB storage cap
const DEFAULT_QUALITY = 0.85;
const MIN_QUALITY = 0.5;

export async function compressImage(file, opts = {}) {
  if (!file || !file.type?.startsWith("image/")) return file;
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // Read dimensions first so we can skip the re-encode for small images.
  const bitmap = await loadBitmap(file);
  const { width: w, height: h } = bitmap;
  const alreadySmall =
    file.size <= maxBytes &&
    w <= maxDim && h <= maxDim &&
    (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp");
  if (alreadySmall) {
    bitmap.close?.();
    return file;
  }

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close?.();

  // Re-encode, dropping quality if the result is still over the byte cap.
  // Three passes is enough to bring almost any photo under 1.5 MB.
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  let q = quality;
  while (blob && blob.size > maxBytes && q > MIN_QUALITY) {
    q = Math.max(MIN_QUALITY, q - 0.15);
    blob = await canvasToBlob(canvas, "image/jpeg", q);
  }
  if (!blob) return file; // encoder failed — let the caller hit the original size cap

  const baseName = (file.name || "avatar").replace(/\.[^./]+$/, "");
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified ?? Date.now(),
  });
}

// Decode via createImageBitmap when available (faster, off-main-thread on
// Chromium/Firefox), fall back to <img> for older Safari.
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}
