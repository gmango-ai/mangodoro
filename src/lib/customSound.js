import { supabase } from "../supabase";

// Custom pomodoro sound uploads, in two scopes:
//   - user: <userId>/sound-<ts>.<ext>            (private to the uploader)
//   - team: team/<teamId>/sound-<ts>.<ext>       (shared with the team)
//
// The bucket is public-read; writes are gated by storage RLS — users may
// write under their own id, team admins may write under team/<teamId>/.

const BUCKET = "pomodoro-sounds";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = [
  "audio/mpeg", "audio/mp3",
  "audio/wav", "audio/x-wav", "audio/wave",
  "audio/ogg",
  "audio/webm",
  "audio/mp4", "audio/aac",
  "audio/flac",
];

const UPLOAD_TIMEOUT_MS = 120_000;

function withTimeout(promise, ms, label = "Upload") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

function validate(file) {
  if (!file) return { message: "No file selected" };
  if (file.size > MAX_BYTES) return { message: "Sound must be under 5 MB" };
  if (file.type && !ALLOWED.includes(file.type)) {
    return { message: "Use MP3, WAV, OGG, M4A, AAC, or FLAC" };
  }
  return null;
}

async function uploadToPath(file, path) {
  const { error: upErr } = await withTimeout(
    supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "audio/mpeg",
    }),
    UPLOAD_TIMEOUT_MS,
    "Sound upload",
  );
  if (upErr) return { error: upErr };
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { data: { url: data.publicUrl, path, name: file.name } };
}

export async function uploadUserSound(file, userId) {
  if (!userId) return { error: { message: "Not signed in" } };
  const v = validate(file);
  if (v) return { error: v };
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5);
  const path = `${userId}/sound-${Date.now()}.${ext}`;
  try {
    return await uploadToPath(file, path);
  } catch (e) {
    return { error: { message: e?.message || "Upload failed" } };
  }
}

export async function uploadTeamSound(file, teamId) {
  if (!teamId) return { error: { message: "No team selected" } };
  const v = validate(file);
  if (v) return { error: v };
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5);
  const path = `team/${teamId}/sound-${Date.now()}.${ext}`;
  try {
    return await uploadToPath(file, path);
  } catch (e) {
    return { error: { message: e?.message || "Upload failed" } };
  }
}

// Remove an uploaded sound by either storage path or full public URL.
// Accepts either form so callers can hand back whichever they kept.
export async function deleteCustomSound(pathOrUrl) {
  if (!pathOrUrl) return { error: null };
  let path = pathOrUrl;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = pathOrUrl.indexOf(marker);
  if (idx >= 0) path = pathOrUrl.substring(idx + marker.length);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error };
}

// Back-compat alias for the original single-sound helper (used by the
// legacy single-upload flow in a few spots that haven't migrated yet).
export const uploadCustomSound = uploadUserSound;
