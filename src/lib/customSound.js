import { supabase } from "../supabase";

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

export async function uploadCustomSound(file, userId) {
  if (!file) return { error: { message: "No file selected" } };
  if (!userId) return { error: { message: "Not signed in" } };
  if (file.size > MAX_BYTES) return { error: { message: "Sound must be under 5 MB" } };
  // Some browsers report empty type or odd subtypes; be permissive.
  if (file.type && !ALLOWED.includes(file.type)) {
    return { error: { message: "Use MP3, WAV, OGG, M4A, AAC, or FLAC" } };
  }

  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5);
  const path = `${userId}/sound-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "audio/mpeg",
    });
  if (upErr) return { error: upErr };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { data: { url: data.publicUrl, path, name: file.name } };
}

export async function deleteCustomSound(url) {
  if (!url) return { error: null };
  // Parse the storage path out of the public URL. Format:
  //   https://<project>.supabase.co/storage/v1/object/public/pomodoro-sounds/<path>
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return { error: { message: "Unrecognized sound URL" } };
  const path = url.substring(idx + marker.length);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error };
}
