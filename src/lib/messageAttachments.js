import { supabase } from "../supabase";

// Message attachment uploads. Mirrors src/lib/avatar.js (size/type guards +
// timeout race so a stuck upload can't lock the UI), against the
// `message-attachments` bucket. One row per file in dm_message_attachments,
// joined to its message.

const BUCKET = "message-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "text/plain",
];
const UPLOAD_TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, label = "Upload") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

const isImage = (mime) => typeof mime === "string" && mime.startsWith("image/");

// Read intrinsic dimensions for images so the thread can reserve space and avoid
// layout jank. Resolves {width,height} or {} for non-images / failures.
function imageSize(file) {
  if (!isImage(file.type)) return Promise.resolve({});
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
      img.src = url;
    } catch { resolve({}); }
  });
}

// Upload one file and insert its attachment row for an already-created message.
export async function attachToMessage(file, conversationId, messageId) {
  if (!file) return { error: { message: "No file selected" } };
  if (file.size > MAX_BYTES) return { error: { message: "File must be under 10 MB" } };
  if (file.type && !ALLOWED.includes(file.type)) return { error: { message: "Unsupported file type" } };

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 8);
  const path = `${conversationId}/${messageId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const { error: upErr } = await withTimeout(
      supabase.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type }),
      UPLOAD_TIMEOUT_MS, "Attachment upload",
    );
    if (upErr) return { error: upErr };
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { width, height } = await imageSize(file);
    const { data, error } = await supabase
      .from("dm_message_attachments")
      .insert({ message_id: messageId, storage_path: path, url: pub.publicUrl, mime: file.type || null, bytes: file.size, width: width ?? null, height: height ?? null })
      .select()
      .single();
    return { data, error };
  } catch (e) {
    return { error: { message: e?.message || "Upload failed" } };
  }
}

export async function listAttachments(messageIds) {
  if (!messageIds || messageIds.length === 0) return new Map();
  const { data } = await supabase
    .from("dm_message_attachments")
    .select("id, message_id, url, mime, bytes, width, height")
    .in("message_id", messageIds);
  const byMessage = new Map();
  for (const a of data || []) {
    const arr = byMessage.get(a.message_id) || [];
    arr.push(a);
    byMessage.set(a.message_id, arr);
  }
  return byMessage;
}

export { isImage };
