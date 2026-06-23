import { supabase } from "../supabase";

// Upload helper for whiteboard image nodes. The board is multiplayer, so the
// node must hold a short URL (synced/saved cheaply) rather than an inline data
// URL — a base64 image would be re-broadcast on every drag and bloat every
// snapshot save. Bytes live in the `whiteboard-images` Storage bucket; see the
// 20260622130000 migration. Mirrors src/lib/avatar.js, plus a downscale pass.

const BUCKET = "whiteboard-images";
const MAX_BYTES = 8 * 1024 * 1024;   // accept up to 8 MB in; we downscale first
const MAX_DIM = 1600;                // cap the longest edge — plenty for a board
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const UPLOAD_TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, label = "Upload") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

// Downscale to <= MAX_DIM on the longest edge and re-encode. GIFs pass through
// untouched so animation survives (rasterizing would freeze them). Returns the
// blob to upload plus its pixel dimensions (used to size the node to ratio).
function processImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      if (file.type === "image/gif") {
        URL.revokeObjectURL(url);
        resolve({ blob: file, type: file.type, width: nw, height: nh });
        return;
      }
      try {
        const scale = Math.min(1, MAX_DIM / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        // Keep PNG/WebP (may have transparency); flatten everything else to JPEG.
        const keepAlpha = file.type === "image/png" || file.type === "image/webp";
        const outType = keepAlpha ? "image/png" : "image/jpeg";
        c.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) { reject(new Error("Could not process image")); return; }
            resolve({ blob, type: outType, width: w, height: h });
          },
          outType,
          0.85,
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

export async function uploadWhiteboardImage(file, userId, boardId) {
  if (!file) return { error: { message: "No file selected" } };
  if (!userId) return { error: { message: "Not signed in" } };
  if (!ALLOWED.includes(file.type)) return { error: { message: "Use JPG, PNG, WebP, or GIF" } };
  if (file.size > MAX_BYTES) return { error: { message: "Image must be under 8 MB" } };

  let out;
  try {
    out = await processImage(file);
  } catch (e) {
    return { error: { message: e?.message || "Could not read that image" } };
  }

  const ext = out.type === "image/png" ? "png" : out.type === "image/gif" ? "gif" : "jpg";
  const path = `${userId}/wb-${boardId || "board"}-${Date.now()}.${ext}`;

  try {
    const { error: upErr } = await withTimeout(
      supabase.storage.from(BUCKET).upload(path, out.blob, {
        cacheControl: "3600",
        upsert: true,
        contentType: out.type,
      }),
      UPLOAD_TIMEOUT_MS,
      "Image upload",
    );
    if (upErr) return { error: upErr };
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { data: { url: data.publicUrl, path, width: out.width, height: out.height } };
  } catch (e) {
    return { error: { message: e?.message || "Upload failed" } };
  }
}

export async function deleteWhiteboardImage(path) {
  if (!path) return { error: null };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error };
}
