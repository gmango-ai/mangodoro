import { supabase } from "../supabase";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadAvatar(file, userId) {
  if (!file) return { error: { message: "No file selected" } };
  if (!userId) return { error: { message: "Not signed in" } };
  if (file.size > MAX_BYTES) return { error: { message: "Image must be under 2 MB" } };
  if (!ALLOWED.includes(file.type)) return { error: { message: "Use JPG, PNG, WebP, or GIF" } };

  const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 5);
  // Cache-busting suffix so the same path can be re-uploaded and CDN serves
  // the new bytes immediately.
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });
  if (upErr) return { error: upErr };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { data: { url: data.publicUrl, path } };
}

export async function deleteAvatar(path) {
  if (!path) return { error: null };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error };
}
