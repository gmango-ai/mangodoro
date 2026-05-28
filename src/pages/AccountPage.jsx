import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import AvatarUploader from "../components/AvatarUploader";
import FileDropZone from "../components/FileDropZone";
import { uploadCustomSound, deleteCustomSound } from "../lib/customSound";
import {
  loadPomodoroSoundSettings, savePomodoroSoundSettings,
  CUSTOM_PRESET_ID,
} from "../lib/pomodoroSound";

// Dedicated profile / uploads page. Lives outside the Settings modal
// portal so file inputs don't sit inside a fixed-position `inset-0`
// container — which is what was freezing the renderer in our PWA.
//
// All settings that involve picking a file (avatar, custom alarm sound)
// live here. The rest of Settings stays in the modal.
export default function AccountPage({ session }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings, setSettings } = useApp();
  const userId = session?.user?.id;

  // Local draft state mirrored to user_settings on save.
  const [name, setName] = useState(settings.name || "");
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl || "");
  const [soundUrl, setSoundUrl] = useState(settings.pomodoroSoundUrl || "");
  const [soundName, setSoundName] = useState(settings.pomodoroSoundName || "");
  const [savingMsg, setSavingMsg] = useState("");
  const [error, setError] = useState("");

  // Keep drafts in sync if settings change (realtime push from another device).
  useEffect(() => { setName(settings.name || ""); }, [settings.name]);
  useEffect(() => { setAvatarUrl(settings.avatarUrl || ""); }, [settings.avatarUrl]);
  useEffect(() => { setSoundUrl(settings.pomodoroSoundUrl || ""); }, [settings.pomodoroSoundUrl]);
  useEffect(() => { setSoundName(settings.pomodoroSoundName || ""); }, [settings.pomodoroSoundName]);

  // Persist any change to user_settings AND local app settings cache. We
  // upsert one column at a time so an in-flight upload can save without
  // racing the other fields.
  async function persist(patch) {
    if (!userId) return;
    const { error: err } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (err) { setError(err.message); return; }
    setSettings((prev) => ({
      ...prev,
      ...(patch.name !== undefined        ? { name: patch.name || "" }                 : {}),
      ...(patch.avatar_url !== undefined  ? { avatarUrl: patch.avatar_url || "" }      : {}),
      ...(patch.pomodoro_sound_url !== undefined  ? { pomodoroSoundUrl: patch.pomodoro_sound_url || "" }   : {}),
      ...(patch.pomodoro_sound_name !== undefined ? { pomodoroSoundName: patch.pomodoro_sound_name || "" } : {}),
    }));
    setSavingMsg("Saved");
    setTimeout(() => setSavingMsg(""), 2000);
  }

  // ── Avatar handlers ───────────────────────────────────────
  function onAvatarChange(url) {
    setAvatarUrl(url || "");
    persist({ avatar_url: url || null });
    // Push the new avatar into any active sync sessions.
    supabase.rpc("refresh_my_sync_avatar").then(() => {}, () => {});
  }

  function onNameBlur() {
    const clean = name.trim();
    if (clean === (settings.name || "")) return;
    persist({ name: clean || null });
  }

  // ── Custom sound handlers ────────────────────────────────
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [uploadingSound, setUploadingSound] = useState(false);
  const [defaultBump, setDefaultBump] = useState(0);
  const soundPrefs = loadPomodoroSoundSettings();
  const isDefault =
    soundUrl
    && soundPrefs.workEndPreset === CUSTOM_PRESET_ID
    && soundPrefs.breakEndPreset === CUSTOM_PRESET_ID;
  void defaultBump;

  async function processSoundFile(file) {
    if (!file) return;
    setUploadingSound(true); setError("");
    try {
      if (soundUrl) await deleteCustomSound(soundUrl);
      const { data, error: err } = await uploadCustomSound(file, userId);
      if (err) { setError(err.message || "Upload failed"); return; }
      setSoundUrl(data.url);
      setSoundName(data.name);
      await persist({ pomodoro_sound_url: data.url, pomodoro_sound_name: data.name });
    } catch (e2) {
      setError(e2?.message || "Upload failed");
    } finally {
      setUploadingSound(false);
    }
  }

  async function removeSound() {
    if (soundUrl) await deleteCustomSound(soundUrl);
    setSoundUrl(""); setSoundName("");
    await persist({ pomodoro_sound_url: null, pomodoro_sound_name: null });
    const isW = soundPrefs.workEndPreset === CUSTOM_PRESET_ID;
    const isB = soundPrefs.breakEndPreset === CUSTOM_PRESET_ID;
    if (isW || isB) {
      savePomodoroSoundSettings({
        ...soundPrefs,
        workEndPreset: isW ? "chime" : soundPrefs.workEndPreset,
        breakEndPreset: isB ? "beep" : soundPrefs.breakEndPreset,
      });
      setDefaultBump((n) => n + 1);
    }
  }

  function togglePreview() {
    if (!soundUrl) return;
    if (playing) {
      if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } }
      setPlaying(false);
      return;
    }
    const a = new Audio(soundUrl);
    audioRef.current = a;
    a.addEventListener("ended", () => setPlaying(false));
    a.play().then(() => setPlaying(true)).catch(() => setError("Couldn't play sound"));
  }

  function toggleDefault() {
    const next = isDefault
      ? { ...soundPrefs, workEndPreset: "chime", breakEndPreset: "beep" }
      : { ...soundPrefs, workEndPreset: CUSTOM_PRESET_ID, breakEndPreset: CUSTOM_PRESET_ID };
    savePomodoroSoundSettings(next);
    setDefaultBump((n) => n + 1);
  }

  // ── Render ────────────────────────────────────────────────
  const sectionCls = `rounded-2xl border p-5 ${
    dark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
  }`;
  const labelCls = `text-xs font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`;
  const inputCls = `w-full max-w-sm h-10 px-3 rounded-md border text-sm ${
    dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"
  }`;

  return (
    <main className={`px-4 pt-6 pb-24 max-w-[720px] mx-auto space-y-6 ${dark ? "text-slate-100" : "text-slate-800"}`}>
      <div className="flex items-center justify-between">
        <Link to="/" className={`inline-flex items-center gap-1 text-sm ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        {savingMsg && (
          <span className={`text-xs ${dark ? "text-emerald-400" : "text-emerald-600"}`}>{savingMsg}</span>
        )}
      </div>

      <h1 className="text-xl font-bold">Account &amp; uploads</h1>
      {error && (
        <div className={`text-sm px-3 py-2 rounded-md ${dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"}`}>{error}</div>
      )}

      {/* ── Profile section ────────────────────────────── */}
      <section className={sectionCls}>
        <p className={`${labelCls} mb-3`}>Profile</p>

        <div className="space-y-4">
          <div>
            <label className={`block ${labelCls} mb-1`}>Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              onBlur={onNameBlur}
              placeholder="e.g. Alex Smith"
              className={inputCls}
              maxLength={60}
            />
          </div>

          <div>
            <label className={`block ${labelCls} mb-2`}>Profile picture</label>
            <AvatarUploader
              userId={userId}
              value={avatarUrl}
              displayName={name}
              size={72}
              onChange={onAvatarChange}
              onError={(msg) => setError(msg)}
            />
          </div>
        </div>
      </section>

      {/* ── Custom alarm sound section ─────────────────── */}
      <section className={sectionCls}>
        <p className={`${labelCls} mb-3`}>Pomodoro alarm sound</p>

        <FileDropZone
          accept={{ "audio/*": [] }}
          maxSize={5 * 1024 * 1024}
          uploading={uploadingSound}
          buttonLabel={soundUrl ? "Replace sound" : "Upload sound"}
          hint={
            soundUrl
              ? (soundName || "Custom sound")
              : "Click or drop an audio file · MP3 / WAV / OGG / M4A / FLAC · up to 5 MB"
          }
          onFile={processSoundFile}
          onReject={(msg) => setError(msg)}
          actions={soundUrl ? (
            <>
              <button
                type="button"
                onClick={togglePreview}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md ${
                  dark ? "bg-slate-800 text-slate-200 border border-slate-700" : "bg-white text-slate-700 border border-slate-200"
                }`}
              >
                {playing ? "Stop" : "Preview"}
              </button>
              <button
                type="button"
                onClick={removeSound}
                className={`text-xs font-medium px-2 py-1.5 rounded-md ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
              >
                Remove
              </button>
            </>
          ) : null}
        />

        {soundUrl && (
          <label className={`mt-3 inline-flex items-center gap-2 text-xs cursor-pointer ${dark ? "text-slate-300" : "text-slate-700"}`}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={toggleDefault}
              className="h-3.5 w-3.5 accent-teal-600"
            />
            Use as my default alarm (focus end + break end)
          </label>
        )}
      </section>
    </main>
  );
}
