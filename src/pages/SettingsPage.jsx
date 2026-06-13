import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Settings as SettingsIcon, User, Palette, Timer, Clock,
  Briefcase, Bell, Database, Check, Sun, Moon, Sparkles,
} from "lucide-react";
import { ACCENTS } from "../lib/accent";
import AvatarUploader from "../components/AvatarUploader";
import FileDropZone from "../components/FileDropZone";
import { uploadCustomSound, deleteCustomSound } from "../lib/customSound";
import {
  loadPomodoroSoundSettings, savePomodoroSoundSettings,
  CUSTOM_PRESET_ID,
} from "../lib/pomodoroSound";

// Settings as a real page (replaces the modal and the old /account
// page — both folded in here). Left sidebar of sections, right pane
// renders the active section. Each section saves what it owns — no
// global Save button, so picking a theme or color commits instantly.
const SECTIONS = [
  { key: "profile",   label: "Profile",     Icon: User },
  { key: "appearance",label: "Appearance",  Icon: Palette },
  { key: "pomodoro",  label: "Pomodoro",    Icon: Timer },
  { key: "tracker",   label: "Time tracker",Icon: Clock },
  { key: "projects",  label: "Projects",    Icon: Briefcase },
  { key: "notifications", label: "Notifications", Icon: Bell },
  { key: "data",      label: "Data",        Icon: Database },
];

export default function SettingsPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [section, setSection] = useState("profile");

  return (
    <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-[var(--color-accent-light)]">
          <SettingsIcon className="w-5 h-5 text-[var(--color-accent)]" />
        </div>
        <h1 className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
          Settings
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-0.5">
          {SECTIONS.map(({ key, label, Icon }) => {
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] font-semibold"
                    : dark
                      ? "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </aside>

        <div className="min-w-0">
          {section === "profile" && <ProfileSection dark={dark} />}
          {section === "appearance" && <AppearanceSection dark={dark} />}
          {section === "pomodoro" && <PomodoroSection dark={dark} />}
          {section === "tracker" && <TimeTrackerSection dark={dark} />}
          {section === "projects" && <ProjectsSection dark={dark} />}
          {section === "notifications" && <NotificationsSection dark={dark} />}
          {section === "data" && <DataSection dark={dark} />}
        </div>
      </div>
    </main>
  );
}

// ── Shared shell ───────────────────────────────────────────────────

function SectionCard({ title, hint, dark, children }) {
  return (
    <div className={`rounded-2xl border p-5 sm:p-6 mb-4 ${
      dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
    }`}>
      <h2 className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
        {title}
      </h2>
      {hint && (
        <p className={`text-xs mt-0.5 mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

// ── Profile: name + avatar + custom alarm sound (from /account) ────

function ProfileSection({ dark }) {
  const { settings, setSettings, session } = useApp();
  const userId = session?.user?.id;

  const [name, setName] = useState(settings.name || "");
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl || "");
  const [soundUrl, setSoundUrl] = useState(settings.pomodoroSoundUrl || "");
  const [soundName, setSoundName] = useState(settings.pomodoroSoundName || "");
  const [error, setError] = useState("");
  const [savingMsg, setSavingMsg] = useState("");

  useEffect(() => { setName(settings.name || ""); }, [settings.name]);
  useEffect(() => { setAvatarUrl(settings.avatarUrl || ""); }, [settings.avatarUrl]);
  useEffect(() => { setSoundUrl(settings.pomodoroSoundUrl || ""); }, [settings.pomodoroSoundUrl]);
  useEffect(() => { setSoundName(settings.pomodoroSoundName || ""); }, [settings.pomodoroSoundName]);

  // Single-column upsert mirrored into local settings cache. Lifted
  // verbatim from the old /account page so the same uploads keep working.
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

  function onAvatarChange(url) {
    setAvatarUrl(url || "");
    persist({ avatar_url: url || null });
    supabase.rpc("refresh_my_sync_avatar").then(() => {}, () => {});
  }

  function onNameBlur() {
    const clean = name.trim();
    if (clean === (settings.name || "")) return;
    persist({ name: clean || null });
  }

  // Custom alarm sound handlers
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [uploadingSound, setUploadingSound] = useState(false);
  const [defaultBump, setDefaultBump] = useState(0);
  void defaultBump; // re-render trigger after savePomodoroSoundSettings
  const soundPrefs = loadPomodoroSoundSettings();
  const isDefault =
    soundUrl
    && soundPrefs.workEndPreset === CUSTOM_PRESET_ID
    && soundPrefs.breakEndPreset === CUSTOM_PRESET_ID;

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

  return (
    <>
      {error && (
        <div className={`mb-3 text-sm px-3 py-2 rounded-md ${
          dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"
        }`}>
          {error}
        </div>
      )}
      {savingMsg && (
        <div className={`mb-3 text-xs ${dark ? "text-emerald-400" : "text-emerald-600"}`}>
          {savingMsg}
        </div>
      )}

      <SectionCard title="Your profile" hint="What teammates see in shared sessions and retros." dark={dark}>
        <div className="space-y-4">
          <div>
            <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Display name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              onBlur={onNameBlur}
              placeholder="e.g. Jacob"
              className="max-w-sm"
              maxLength={60}
            />
          </div>
          <div>
            <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Profile picture
            </label>
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
      </SectionCard>

      <SectionCard
        title="Pomodoro alarm sound"
        hint="Upload a custom audio file. Used when a focus or break cycle ends."
        dark={dark}
      >
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
              className="h-3.5 w-3.5"
              style={{ accentColor: "var(--color-accent)" }}
            />
            Use as my default alarm (focus end + break end)
          </label>
        )}
      </SectionCard>
    </>
  );
}

// ── Appearance: theme + accent ─────────────────────────────────────

function AppearanceSection({ dark }) {
  const { settings, updateSettingsField } = useApp();
  const { toggleTheme } = useTheme();
  const current = settings.accentColor || "teal";

  return (
    <>
      <SectionCard title="Theme" hint="Switch between light and dark mode." dark={dark}>
        <div className="flex gap-2">
          {[
            { key: "light", label: "Light", Icon: Sun },
            { key: "dark", label: "Dark", Icon: Moon },
          ].map(({ key, label, Icon }) => {
            const active = (key === "dark") === dark;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { if (active) return; toggleTheme(); }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                    : dark
                      ? "border-slate-700 text-slate-400 hover:border-slate-600"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Accent color"
        hint="Used on buttons, links, focus rings, and active states. Saves immediately."
        dark={dark}
      >
        <div className="grid grid-cols-5 gap-3">
          {ACCENTS.map((a) => {
            const active = current === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => updateSettingsField({ accentColor: a.key })}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                    : dark
                      ? "border-transparent hover:border-slate-700"
                      : "border-transparent hover:border-slate-300"
                }`}
                aria-label={a.label}
                aria-pressed={active}
              >
                <span
                  className="w-10 h-10 rounded-full relative shrink-0"
                  style={{ background: a.swatch }}
                >
                  {active && (
                    <Check className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 text-white drop-shadow" />
                  )}
                </span>
                <span className={`text-[11px] font-semibold ${
                  dark ? "text-slate-400" : "text-slate-600"
                }`}>
                  {a.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className={`text-[11px] mt-3 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Heads-up: some surfaces still use the original teal/cyan palette. Migrating those is a multi-PR sweep.
        </p>
      </SectionCard>
    </>
  );
}

// ── Stub sections — content lives in the legacy modal for now ──────

function PomodoroSection({ dark }) {
  return (
    <SectionCard title="Pomodoro" hint="Sound, durations, and timer behavior." dark={dark}>
      <p className={`text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
        Custom alarm sound lives under Profile above. Per-cycle durations and the sound preset picker stay on the timer card for now.
      </p>
    </SectionCard>
  );
}

function TimeTrackerSection({ dark }) {
  const { timeRounding, dailyTarget, weeklyTarget } = useApp();
  return (
    <SectionCard title="Defaults" hint="Time rounding and weekly targets." dark={dark}>
      <p className={`text-xs mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        Rounding: <span className="font-semibold">{timeRounding}</span>
      </p>
      <p className={`text-xs mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        Daily target: <span className="font-semibold">{dailyTarget || 0}h</span> · Weekly: <span className="font-semibold">{weeklyTarget || 0}h</span>
      </p>
      <p className={`text-[11px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
        Editing these here is coming soon — for now the legacy modal is the editing surface.
      </p>
    </SectionCard>
  );
}

function ProjectsSection({ dark }) {
  return (
    <SectionCard title="Projects & templates" hint="Manage your project list and time-entry templates." dark={dark}>
      <p className={`text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
        The full project + template editor is currently in the legacy settings dialog. Open it from the timer card's Settings cog.
      </p>
    </SectionCard>
  );
}

function NotificationsSection({ dark }) {
  const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
  return (
    <SectionCard title="Browser notifications" hint="So you know when a teammate starts a session or a timer ends." dark={dark}>
      {granted ? (
        <p className={`inline-flex items-center gap-1.5 text-sm ${dark ? "text-emerald-300" : "text-emerald-700"}`}>
          <Check className="w-4 h-4" /> Enabled
        </p>
      ) : (
        <Button
          onClick={() => Notification.requestPermission()}
          variant="outline"
          size="sm"
        >
          <Bell className="w-3.5 h-3.5 mr-1.5" /> Allow notifications
        </Button>
      )}
    </SectionCard>
  );
}

function DataSection({ dark }) {
  const { exportAllXLSX, exportProfile } = useApp();
  return (
    <SectionCard title="Export" hint="Download a full XLSX of your time entries, or your account profile JSON." dark={dark}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportAllXLSX} variant="outline" size="sm">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Export all (XLSX)
        </Button>
        <Button onClick={exportProfile} variant="outline" size="sm">
          Export profile (JSON)
        </Button>
      </div>
    </SectionCard>
  );
}
