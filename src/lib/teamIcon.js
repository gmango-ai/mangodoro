import { supabase } from "../supabase";

const BUCKET = "team-icons";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];

const UPLOAD_TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, label = "Upload") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

export async function uploadTeamIcon(file, teamId) {
  if (!file) return { error: { message: "No file selected" } };
  if (!teamId) return { error: { message: "No team selected" } };
  if (file.size > MAX_BYTES) return { error: { message: "Icon must be under 2 MB" } };
  if (file.type && !ALLOWED.includes(file.type)) {
    return { error: { message: "Use JPG, PNG, WebP, GIF, or SVG" } };
  }

  const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 5);
  const path = `${teamId}/icon-${Date.now()}.${ext}`;

  try {
    const { error: upErr } = await withTimeout(
      supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/png",
      }),
      UPLOAD_TIMEOUT_MS,
      "Team icon upload",
    );
    if (upErr) return { error: upErr };
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { data: { url: data.publicUrl, path } };
  } catch (e) {
    return { error: { message: e?.message || "Upload failed" } };
  }
}

export async function deleteTeamIcon(url) {
  if (!url) return { error: null };
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return { error: { message: "Unrecognized icon URL" } };
  const path = url.substring(idx + marker.length);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error };
}
