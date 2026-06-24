import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Settings as SettingsIcon, User, Palette, Timer, Clock,
  Briefcase, Bell, Database, Check, Sun, Moon, Sparkles,
  FileText, Download, Upload, KeyRound,
} from "lucide-react";
import { ACCENTS } from "../lib/accent";
import AvatarUploader from "../components/AvatarUploader";
import SoundLibrary from "../components/SoundLibrary";
import TimeSelect from "../components/TimeSelect";
import { toDisplayTime } from "../lib/utils";
import { loadPomodoroSoundSettings, savePomodoroSoundSettings, USER_SOUND_PREFIX } from "../lib/pomodoroSound";
import { clearCachedNotificationSound } from "../lib/nativeNotifications";
import { NOTIFICATION_TYPES, listPreferences, setPreferenceEnabled } from "../lib/notifications";
import { REMINDERS, REMINDER_INTERVALS, reminderConfig } from "../lib/reminders";

// Settings as a real page. Left rail of sections, right pane renders
// the active section. Sections persist on field commit (blur/change)
// instead of via a global Save — picking a theme or color commits
// instantly, and the small toast at the top of each section confirms.

const SECTIONS = [
  { key: "profile",       label: "Profile",       Icon: User },
  { key: "appearance",    label: "Appearance",    Icon: Palette },
  { key: "pomodoro",      label: "Pomodoro",      Icon: Timer },
  { key: "tracker",       label: "Time tracker",  Icon: Clock },
  { key: "projects",      label: "Projects",      Icon: Briefcase },
  { key: "notifications", label: "Notifications", Icon: Bell },
  { key: "data",          label: "Data",          Icon: Database },
];

const PROJECT_COLORS = ["#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#64748b"];

// Pastel palette for retro sticky notes. Stays light enough that body
// text reads in either theme without needing per-color contrast tweaks.
const STICKY_COLORS = [
  { hex: "#fde68a", label: "Yellow" },
  { hex: "#fbcfe8", label: "Pink" },
  { hex: "#bfdbfe", label: "Blue" },
  { hex: "#bbf7d0", label: "Green" },
  { hex: "#ddd6fe", label: "Purple" },
  { hex: "#fed7aa", label: "Orange" },
  { hex: "#fecaca", label: "Coral" },
  { hex: "#e2e8f0", label: "Slate" },
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
        <aside className="space-y-0.5 self-start md:sticky md:top-20">
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
                      ? "text-slate-400 hover:bg-[var(--color-surface-raised)] hover:text-slate-200"
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

// ── Shared shell ──────────────────────────────────────────────────

function SectionCard({ title, hint, dark, children, action }) {
  return (
    <div
      className={`rounded-2xl border p-5 sm:p-6 mb-4 ${
        dark ? "" : "bg-white border-slate-200"
      }`}
      style={dark ? { background: "var(--color-surface)", borderColor: "var(--color-border)" } : undefined}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h2 className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {title}
          </h2>
          {hint && (
            <p className={`text-xs mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {hint}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Toast({ message, dark, tone = "ok" }) {
  if (!message) return null;
  const cls = tone === "err"
    ? (dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700")
    : (dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700");
  return (
    <div className={`mb-3 text-xs px-3 py-2 rounded-md ${cls}`}>{message}</div>
  );
}

function FieldLabel({ children, dark, hint }) {
  return (
    <div className="mb-1.5">
      <span className={`block text-[10px] font-semibold uppercase tracking-wider ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        {children}
      </span>
      {hint && (
        <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}

// Tiny helper that writes one column to user_settings via upsert.
// Mirrors the modal's saveSettings() shape so behavior stays identical
// — just narrower. Returns a promise so callers can chain a savedAt
// notification.
async function persistUserSettings(userId, patch) {
  if (!userId) return { error: { message: "Not signed in" } };
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  return { error };
}

// ── Profile: name, avatar, status, hourly rate, custom alarm ───────

function ProfileSection({ dark }) {
  const {
    settings, setSettings, session,
    hourlyRate, setHourlyRate,
    updateSettingsField,
    addCustomSound, renameCustomSound, removeCustomSound,
  } = useApp();
  const { teamSounds } = useTeam();
  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());
  function updateSound(patch) {
    setSoundSettings((prev) => {
      const next = { ...prev, ...patch };
      savePomodoroSoundSettings(next);
      return next;
    });
  }
  const userId = session?.user?.id;

  const [name, setName] = useState(settings.name || "");
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl || "");
  const [status, setStatus] = useState(settings.status || "");
  const [presenceState, setPresenceState] = useState(settings.presenceState || "active");
  const [rateDraft, setRateDraft] = useState(hourlyRate ? String(hourlyRate) : "");
  const [error, setError] = useState("");
  const [savingMsg, setSavingMsg] = useState("");

  useEffect(() => { setName(settings.name || ""); }, [settings.name]);
  useEffect(() => { setAvatarUrl(settings.avatarUrl || ""); }, [settings.avatarUrl]);
  useEffect(() => { setStatus(settings.status || ""); }, [settings.status]);
  useEffect(() => { setPresenceState(settings.presenceState || "active"); }, [settings.presenceState]);
  useEffect(() => { setRateDraft(hourlyRate ? String(hourlyRate) : ""); }, [hourlyRate]);

  function flashSaved() {
    setSavingMsg("Saved");
    setTimeout(() => setSavingMsg(""), 1500);
  }

  async function persist(patch) {
    const { error: err } = await persistUserSettings(userId, patch);
    if (err) { setError(err.message); return false; }
    setSettings((prev) => ({
      ...prev,
      ...(patch.name !== undefined        ? { name: patch.name || "" }                 : {}),
      ...(patch.avatar_url !== undefined  ? { avatarUrl: patch.avatar_url || "" }      : {}),
    }));
    flashSaved();
    return true;
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

  function onStatusBlur() {
    const clean = status.trim().slice(0, 80);
    if (clean === (settings.status || "")) return;
    updateSettingsField({ status: clean || null });
    flashSaved();
  }

  function pickPresence(key) {
    if (presenceState === key) return;
    setPresenceState(key);
    updateSettingsField({ presenceState: key });
    flashSaved();
  }

  async function onRateBlur() {
    const rate = parseFloat(rateDraft);
    const clean = Number.isFinite(rate) && rate >= 0 ? rate : 0;
    if (clean === hourlyRate) return;
    const { error: err } = await persistUserSettings(userId, { hourly_rate: clean });
    if (err) { setError(err.message); return; }
    setHourlyRate(clean);
    flashSaved();
  }

  const PRESENCE = [
    { key: "active", label: "Active", color: "bg-emerald-500" },
    { key: "available", label: "Available", color: "bg-sky-500" },
    { key: "heads_down", label: "Heads-down", color: "bg-violet-500" },
    { key: "in_meeting", label: "In meeting", color: "bg-rose-500" },
    { key: "away", label: "Away", color: "bg-amber-500" },
  ];

  return (
    <>
      <Toast message={error} dark={dark} tone="err" />
      <Toast message={savingMsg} dark={dark} />

      <SectionCard title="Your profile" hint="What teammates see in shared sessions and retros." dark={dark}>
        <div className="space-y-4">
          <div>
            <FieldLabel dark={dark}>Display name</FieldLabel>
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
            <FieldLabel dark={dark}>Profile picture</FieldLabel>
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

      <SectionCard title="Status" hint="Visible to teammates. Updates instantly." dark={dark}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESENCE.map((opt) => {
              const active = presenceState === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => pickPresence(opt.key)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    active
                      ? "bg-[var(--color-accent)] text-white"
                      : dark
                        ? "bg-[var(--color-surface-raised)] text-slate-300 hover:bg-slate-700"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${opt.color}`} />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <Input
            value={status}
            onChange={(e) => setStatus(e.target.value.slice(0, 80))}
            onBlur={onStatusBlur}
            placeholder="What are you working on? (optional)"
            maxLength={80}
            className="max-w-md"
          />
        </div>
      </SectionCard>

      <SectionCard title="Hourly rate" hint="Used to calculate earnings on the Overview page." dark={dark}>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>$</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={rateDraft}
            onChange={(e) => setRateDraft(e.target.value)}
            onBlur={onRateBlur}
            placeholder="0.00"
            className="w-28"
          />
          <span className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>/ hr</span>
        </div>
      </SectionCard>

      <SectionCard
        title="Pomodoro sounds"
        hint="Upload your own alarms or pick from the built-in library. Tap a card to preview; the Focus / Break pills assign it as the alarm for that phase."
        dark={dark}
      >
        <SoundLibrary
          mode="manage"
          userSounds={settings.customSounds || []}
          teamSounds={teamSounds || []}
          soundSettings={soundSettings}
          onSelectFocus={(presetId) => { updateSound({ workEndPreset: presetId }); flashSaved(); }}
          onSelectBreak={(presetId) => { updateSound({ breakEndPreset: presetId }); flashSaved(); }}
          onUpdateSettings={updateSound}
          onAddSound={async (file) => {
            const r = await addCustomSound(file);
            if (r.error) setError(r.error.message || "Upload failed");
            else flashSaved();
          }}
          onRenameSound={async (id, name) => {
            const r = await renameCustomSound(id, name);
            if (r.error) setError(r.error.message); else flashSaved();
          }}
          onRemoveSound={async (sound) => {
            const r = await removeCustomSound(sound.id);
            if (r.error) { setError(r.error.message); return; }
            // Drop the cached copy from Library/Sounds so we don't
            // leak a stale MP3 if the user uploads a new one with
            // the same name later.
            clearCachedNotificationSound(`${USER_SOUND_PREFIX}${sound.id}`);
            flashSaved();
          }}
          onError={setError}
        />
      </SectionCard>

    </>
  );
}

// ── Appearance: theme + accent + sticky-note color ─────────────────

function AppearanceSection({ dark }) {
  const { settings, updateSettingsField, session, stickyColor, setStickyColor } = useApp();
  const { toggleTheme } = useTheme();
  const userId = session?.user?.id;
  const current = settings.accentColor || "teal";

  async function pickSticky(hex) {
    if (hex === stickyColor) return;
    setStickyColor(hex);
    await persistUserSettings(userId, { sticky_color: hex });
  }

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
                      ? "border-[var(--color-border)] text-slate-400 hover:border-slate-600"
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
                      ? "border-transparent hover:border-[var(--color-border)]"
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
      </SectionCard>

      <SectionCard
        title="Retro sticky-note color"
        hint="Background tint for the retro cards you write."
        dark={dark}
      >
        <div className="flex flex-wrap gap-2">
          {STICKY_COLORS.map((c) => {
            const active = (stickyColor || "#fde68a").toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => pickSticky(c.hex)}
                title={c.label}
                aria-label={c.label}
                className="rounded-lg"
                style={{
                  width: 32,
                  height: 32,
                  background: c.hex,
                  border: active ? "2px solid var(--color-text)" : "2px solid transparent",
                  boxShadow: active ? "0 0 0 1px var(--color-surface)" : "none",
                }}
              />
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

// ── Pomodoro: landing page + DeepSeek key ──────────────────────────

function PomodoroSection({ dark }) {
  const {
    session,
    defaultLandingPage, setDefaultLandingPage,
    deepseekKey, setDeepseekKey,
  } = useApp();
  const userId = session?.user?.id;

  const [landing, setLanding] = useState(defaultLandingPage || "pomodoro");
  const [keyDraft, setKeyDraft] = useState(deepseekKey || "");
  const [savingMsg, setSavingMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setLanding(defaultLandingPage || "pomodoro"); }, [defaultLandingPage]);
  useEffect(() => { setKeyDraft(deepseekKey || ""); }, [deepseekKey]);

  function flashSaved() { setSavingMsg("Saved"); setTimeout(() => setSavingMsg(""), 1500); }

  async function pickLanding(v) {
    const clean = v === "log" ? "log" : "pomodoro";
    if (clean === landing) return;
    setLanding(clean);
    const { error: err } = await persistUserSettings(userId, { default_landing_page: clean });
    if (err) { setError(err.message); return; }
    setDefaultLandingPage(clean);
    try { localStorage.setItem("ql_default_landing", clean); } catch { /* ignore */ }
    flashSaved();
  }

  async function onKeyBlur() {
    const clean = (keyDraft || "").trim();
    if (clean === (deepseekKey || "")) return;
    const { error: err } = await persistUserSettings(userId, { deepseek_key: clean });
    if (err) { setError(err.message); return; }
    setDeepseekKey(clean);
    flashSaved();
  }

  return (
    <>
      <Toast message={error} dark={dark} tone="err" />
      <Toast message={savingMsg} dark={dark} />

      <SectionCard
        title="Default landing page"
        hint="Where opening the app drops you."
        dark={dark}
      >
        <Select value={landing} onValueChange={pickLanding}>
          <SelectTrigger className="h-10 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pomodoro">Pomodoro</SelectItem>
            <SelectItem value="log">Time tracker</SelectItem>
          </SelectContent>
        </Select>
      </SectionCard>

      <SectionCard
        title="DeepSeek API key"
        hint="Enables the description rewriter and month summaries on the time tracker."
        dark={dark}
      >
        <div className="flex items-center gap-2 max-w-md">
          <KeyRound className={`w-4 h-4 shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`} />
          <Input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={onKeyBlur}
            placeholder="sk-…"
            className="font-mono"
          />
        </div>
      </SectionCard>
    </>
  );
}

// ── Time tracker: rounding, targets, defaults, templates ───────────

function TimeTrackerSection({ dark }) {
  const {
    session, settings, setSettings, templates, setTemplates,
    defaultEntryMode, setDefaultEntryMode,
    timeRounding, setTimeRounding,
    dailyTarget, setDailyTarget,
    weeklyTarget, setWeeklyTarget,
  } = useApp();
  const userId = session?.user?.id;

  const [entryMode, setEntryMode] = useState(defaultEntryMode || "manual");
  const [rounding, setRounding] = useState(timeRounding || "none");
  const [daily, setDaily] = useState(dailyTarget ? String(dailyTarget) : "");
  const [weekly, setWeekly] = useState(weeklyTarget ? String(weeklyTarget) : "");
  const [defaultTplId, setDefaultTplId] = useState(settings.defaultTemplateId || "");
  const [defaultStart, setDefaultStart] = useState(settings.defaultStart || "");
  const [defaultEnd, setDefaultEnd] = useState(settings.defaultEnd || "");

  const [error, setError] = useState("");
  const [savingMsg, setSavingMsg] = useState("");

  useEffect(() => { setEntryMode(defaultEntryMode || "manual"); }, [defaultEntryMode]);
  useEffect(() => { setRounding(timeRounding || "none"); }, [timeRounding]);
  useEffect(() => { setDaily(dailyTarget ? String(dailyTarget) : ""); }, [dailyTarget]);
  useEffect(() => { setWeekly(weeklyTarget ? String(weeklyTarget) : ""); }, [weeklyTarget]);
  useEffect(() => { setDefaultTplId(settings.defaultTemplateId || ""); }, [settings.defaultTemplateId]);
  useEffect(() => { setDefaultStart(settings.defaultStart || ""); }, [settings.defaultStart]);
  useEffect(() => { setDefaultEnd(settings.defaultEnd || ""); }, [settings.defaultEnd]);

  function flashSaved() { setSavingMsg("Saved"); setTimeout(() => setSavingMsg(""), 1500); }

  async function pickEntryMode(v) {
    const clean = v === "auto" ? "auto" : "manual";
    if (clean === entryMode) return;
    setEntryMode(clean);
    const { error: err } = await persistUserSettings(userId, { default_entry_mode: clean });
    if (err) { setError(err.message); return; }
    setDefaultEntryMode(clean);
    flashSaved();
  }

  async function pickRounding(v) {
    if (v === rounding) return;
    setRounding(v);
    const { error: err } = await persistUserSettings(userId, { time_rounding: v });
    if (err) { setError(err.message); return; }
    setTimeRounding(v);
    flashSaved();
  }

  async function onDailyBlur() {
    const n = parseFloat(daily);
    const clean = Number.isFinite(n) && n >= 0 ? n : 0;
    if (clean === dailyTarget) return;
    const { error: err } = await persistUserSettings(userId, { daily_target: clean });
    if (err) { setError(err.message); return; }
    setDailyTarget(clean);
    flashSaved();
  }

  async function onWeeklyBlur() {
    const n = parseFloat(weekly);
    const clean = Number.isFinite(n) && n >= 0 ? n : 0;
    if (clean === weeklyTarget) return;
    const { error: err } = await persistUserSettings(userId, { weekly_target: clean });
    if (err) { setError(err.message); return; }
    setWeeklyTarget(clean);
    flashSaved();
  }

  async function pickDefaultTemplate(v) {
    const clean = v === "__none__" ? null : v;
    if ((clean || "") === (defaultTplId || "")) return;
    setDefaultTplId(clean || "");
    const { error: err } = await persistUserSettings(userId, { default_template_id: clean });
    if (err) { setError(err.message); return; }
    setSettings((s) => ({ ...s, defaultTemplateId: clean || undefined }));
    flashSaved();
  }

  async function commitDefaultStart(v) {
    if ((v || "") === (settings.defaultStart || "")) return;
    setDefaultStart(v || "");
    const { error: err } = await persistUserSettings(userId, { default_start: v || null });
    if (err) { setError(err.message); return; }
    setSettings((s) => ({ ...s, defaultStart: v || "" }));
    flashSaved();
  }

  async function commitDefaultEnd(v) {
    if ((v || "") === (settings.defaultEnd || "")) return;
    setDefaultEnd(v || "");
    const { error: err } = await persistUserSettings(userId, { default_end: v || null });
    if (err) { setError(err.message); return; }
    setSettings((s) => ({ ...s, defaultEnd: v || "" }));
    flashSaved();
  }

  return (
    <>
      <Toast message={error} dark={dark} tone="err" />
      <Toast message={savingMsg} dark={dark} />

      <SectionCard title="Entry behavior" hint="How the log form opens and rounds time." dark={dark}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel dark={dark}>Default entry mode</FieldLabel>
            <Select value={entryMode} onValueChange={pickEntryMode}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="auto">Automatic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <FieldLabel dark={dark} hint="Down on clock in, up on clock out">
              Time rounding
            </FieldLabel>
            <Select value={rounding} onValueChange={pickRounding}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[["none", "No rounding"], ["1", "1 minute"], ["5", "5 minutes"], ["15", "15 minutes"], ["30", "30 minutes"]].map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Goals" hint="Targets shown on the Overview page." dark={dark}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel dark={dark}>Daily goal</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                type="number" min="0" max="24" step="0.5"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                onBlur={onDailyBlur}
                placeholder="0"
                className="w-28"
              />
              <span className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>hrs / day</span>
            </div>
          </div>
          <div>
            <FieldLabel dark={dark}>Weekly goal</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                type="number" min="0" max="168" step="1"
                value={weekly}
                onChange={(e) => setWeekly(e.target.value)}
                onBlur={onWeeklyBlur}
                placeholder="0"
                className="w-28"
              />
              <span className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>hrs / week</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Defaults for new entries"
        hint={defaultTplId ? "Default template overrides start & end times." : "Pick a template or set start/end manually."}
        dark={dark}
      >
        <div className="space-y-4">
          <div>
            <FieldLabel dark={dark}>Default template</FieldLabel>
            <Select value={defaultTplId || "__none__"} onValueChange={pickDefaultTemplate}>
              <SelectTrigger className="h-10 max-w-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!defaultTplId && (
            <div className="grid sm:grid-cols-2 gap-4 max-w-md">
              <div>
                <FieldLabel dark={dark}>Default start</FieldLabel>
                <TimeSelect value={defaultStart} onChange={commitDefaultStart} />
              </div>
              <div>
                <FieldLabel dark={dark}>Default end</FieldLabel>
                <TimeSelect value={defaultEnd} onChange={commitDefaultEnd} />
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <TemplatesCard
        dark={dark}
        userId={userId}
        templates={templates}
        setTemplates={setTemplates}
        defaultTplId={defaultTplId}
        onClearDefault={() => pickDefaultTemplate("__none__")}
        onError={setError}
        onSaved={flashSaved}
      />
    </>
  );
}

// Templates CRUD — collapsed inline editor. Each save round-trips to
// supabase directly rather than relying on the legacy draft pipeline.
function TemplatesCard({ dark, userId, templates, setTemplates, defaultTplId, onClearDefault, onError, onSaved }) {
  const [editing, setEditing] = useState(null); // null | { id?: uuid, name, start, end, breaks: [] }
  const [busy, setBusy] = useState(false);

  function newTemplate() {
    setEditing({ name: "", start: "", end: "", breaks: [] });
  }
  function edit(t) {
    setEditing({ id: t.id, name: t.name, start: t.start || "", end: t.end || "", breaks: [...(t.breaks || [])] });
  }
  function patch(patchObj) { setEditing((d) => ({ ...d, ...patchObj })); }
  function addBreak() {
    setEditing((d) => ({ ...d, breaks: [...(d.breaks || []), { id: Date.now(), start: "", end: "", unpaid: true }] }));
  }
  function changeBreak(bid, p) {
    setEditing((d) => ({ ...d, breaks: d.breaks.map((b) => b.id === bid ? { ...b, ...p } : b) }));
  }
  function removeBreak(bid) {
    setEditing((d) => ({ ...d, breaks: d.breaks.filter((b) => b.id !== bid) }));
  }

  async function commit() {
    if (!editing.name || !editing.start || !editing.end) return;
    setBusy(true);
    const row = {
      user_id: userId,
      name: editing.name,
      start: editing.start || null,
      end_time: editing.end || null,
      breaks: editing.breaks || [],
    };
    if (editing.id) row.id = editing.id;
    const { data, error } = await supabase.from("templates").upsert(row).select().single();
    setBusy(false);
    if (error) { onError(error.message); return; }
    const saved = { id: data.id, name: data.name, start: data.start || "", end: data.end_time || "", breaks: data.breaks || [] };
    setTemplates((prev) => {
      const existing = prev.find((t) => t.id === saved.id);
      return existing ? prev.map((t) => t.id === saved.id ? saved : t) : [...prev, saved];
    });
    setEditing(null);
    onSaved?.();
  }

  async function remove(id) {
    if (!window.confirm("Delete this template?")) return;
    setBusy(true);
    const { error } = await supabase.from("templates").delete().eq("id", id);
    setBusy(false);
    if (error) { onError(error.message); return; }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (defaultTplId === id) onClearDefault();
    onSaved?.();
  }

  return (
    <SectionCard
      title="Templates"
      hint="Reusable shift presets — name, start, end, and optional breaks."
      dark={dark}
      action={
        !editing && (
          <button
            type="button"
            onClick={newTemplate}
            className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            + New template
          </button>
        )
      }
    >
      {templates.length === 0 && !editing && (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          No templates yet. A template lets you reuse a start/end + break setup with one click on the log form.
        </p>
      )}
      <div className="space-y-2">
        {templates.map((t) => {
          if (editing?.id === t.id) {
            return (
              <TemplateEditor
                key={t.id}
                dark={dark}
                value={editing}
                busy={busy}
                onChange={patch}
                onAddBreak={addBreak}
                onChangeBreak={changeBreak}
                onRemoveBreak={removeBreak}
                onSave={commit}
                onCancel={() => setEditing(null)}
                saveLabel="Update template"
              />
            );
          }
          const breakCount = (t.breaks || []).length;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {t.name}
                </p>
                <p className={`text-[11px] font-mono ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {toDisplayTime(t.start)} – {toDisplayTime(t.end)}
                  {breakCount > 0 && ` · ${breakCount} break${breakCount > 1 ? "s" : ""}`}
                </p>
              </div>
              {defaultTplId === t.id && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                  Default
                </span>
              )}
              <button
                type="button"
                onClick={() => edit(t)}
                className={`text-xs font-semibold px-2 py-1 rounded ${dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className={`text-xs px-2 py-1 rounded ${dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
              >
                Delete
              </button>
            </div>
          );
        })}
        {editing && !editing.id && (
          <TemplateEditor
            dark={dark}
            value={editing}
            busy={busy}
            onChange={patch}
            onAddBreak={addBreak}
            onChangeBreak={changeBreak}
            onRemoveBreak={removeBreak}
            onSave={commit}
            onCancel={() => setEditing(null)}
            saveLabel="Add template"
          />
        )}
      </div>
    </SectionCard>
  );
}

function TemplateEditor({ dark, value, busy, onChange, onAddBreak, onChangeBreak, onRemoveBreak, onSave, onCancel, saveLabel }) {
  return (
    <div className={`rounded-lg border p-3 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-white border-slate-200"}`}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 mb-3 items-end">
        <div>
          <FieldLabel dark={dark}>Name</FieldLabel>
          <Input
            value={value.name || ""}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Regular day"
            className="h-9"
          />
        </div>
        <div>
          <FieldLabel dark={dark}>Start</FieldLabel>
          <TimeSelect value={value.start || ""} onChange={(v) => onChange({ start: v })} />
        </div>
        <div>
          <FieldLabel dark={dark}>End</FieldLabel>
          <TimeSelect value={value.end || ""} onChange={(v) => onChange({ end: v })} />
        </div>
      </div>
      {(value.breaks || []).map((b) => (
        <div
          key={b.id}
          className={`flex items-center gap-2 px-2 py-2 rounded-md mb-2 border ${dark ? "border-[var(--color-border)] bg-[var(--color-bg)]" : "bg-slate-50 border-slate-200"}`}
        >
          <span className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>From</span>
          <TimeSelect value={b.start} onChange={(v) => onChangeBreak(b.id, { start: v })} />
          <span className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>→</span>
          <TimeSelect value={b.end} onChange={(v) => onChangeBreak(b.id, { end: v })} />
          <Checkbox
            id={`tb-${b.id}`}
            checked={b.unpaid}
            onCheckedChange={(v) => onChangeBreak(b.id, { unpaid: !!v })}
            className="border-slate-300 data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)] h-4 w-4"
          />
          <Label htmlFor={`tb-${b.id}`} className={`text-[11px] ${dark ? "text-slate-300" : "text-slate-700"}`}>
            Unpaid
          </Label>
          <button
            type="button"
            onClick={() => onRemoveBreak(b.id)}
            className={`ml-auto text-sm leading-none ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}
            aria-label="Remove break"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between mt-2">
        <Button variant="outline" size="sm" onClick={onAddBreak} className="h-7 text-xs">
          + Add break
        </Button>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={busy || !value.name || !value.start || !value.end}
            className="h-7 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Projects: full CRUD ────────────────────────────────────────────

function ProjectsSection({ dark }) {
  const { session, projects, setProjects } = useApp();
  const userId = session?.user?.id;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savingMsg, setSavingMsg] = useState("");

  function flashSaved() { setSavingMsg("Saved"); setTimeout(() => setSavingMsg(""), 1500); }

  function newProj() {
    setEditing({ name: "", client_name: "", color: PROJECT_COLORS[0] });
  }
  function edit(p) {
    setEditing({ id: p.id, name: p.name, client_name: p.client_name || "", color: p.color || PROJECT_COLORS[0] });
  }

  async function commit() {
    if (!editing?.name) return;
    setBusy(true);
    const row = {
      user_id: userId,
      name: editing.name,
      client_name: editing.client_name || "",
      color: editing.color || PROJECT_COLORS[0],
    };
    if (editing.id) row.id = editing.id;
    const { data, error: err } = await supabase.from("projects").upsert(row).select().single();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setProjects((prev) => {
      const existing = prev.find((p) => p.id === data.id);
      return existing ? prev.map((p) => p.id === data.id ? data : p) : [...prev, data];
    });
    setEditing(null);
    flashSaved();
  }

  async function remove(id) {
    if (!window.confirm("Delete this project? Entries already logged will stay but lose their project link.")) return;
    setBusy(true);
    const { error: err } = await supabase.from("projects").delete().eq("id", id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    flashSaved();
  }

  return (
    <>
      <Toast message={error} dark={dark} tone="err" />
      <Toast message={savingMsg} dark={dark} />

      <SectionCard
        title="Projects"
        hint="Tag time entries by project so you can break down hours and earnings."
        dark={dark}
        action={
          !editing && (
            <button
              type="button"
              onClick={newProj}
              className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              + New project
            </button>
          )
        }
      >
        {projects.length === 0 && !editing && (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            No projects yet.
          </p>
        )}
        <div className="space-y-2">
          {projects.map((p) => {
            if (editing?.id === p.id) {
              return (
                <ProjectEditor
                  key={p.id}
                  dark={dark}
                  value={editing}
                  busy={busy}
                  onChange={(patch) => setEditing((d) => ({ ...d, ...patch }))}
                  onSave={commit}
                  onCancel={() => setEditing(null)}
                  saveLabel="Update project"
                />
              );
            }
            return (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                  dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-slate-50 border-slate-200"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: p.color || PROJECT_COLORS[0] }}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    {p.name}
                  </p>
                  {p.client_name && (
                    <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {p.client_name}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => edit(p)}
                  className={`text-xs font-semibold px-2 py-1 rounded ${dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className={`text-xs px-2 py-1 rounded ${dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
                >
                  Delete
                </button>
              </div>
            );
          })}
          {editing && !editing.id && (
            <ProjectEditor
              dark={dark}
              value={editing}
              busy={busy}
              onChange={(patch) => setEditing((d) => ({ ...d, ...patch }))}
              onSave={commit}
              onCancel={() => setEditing(null)}
              saveLabel="Add project"
            />
          )}
        </div>
      </SectionCard>
    </>
  );
}

function ProjectEditor({ dark, value, busy, onChange, onSave, onCancel, saveLabel }) {
  return (
    <div className={`rounded-lg border p-3 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-white border-slate-200"}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <FieldLabel dark={dark}>Project name</FieldLabel>
          <Input
            value={value.name || ""}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Acme Corp"
            className="h-9"
          />
        </div>
        <div>
          <FieldLabel dark={dark}>Client</FieldLabel>
          <Input
            value={value.client_name || ""}
            onChange={(e) => onChange({ client_name: e.target.value })}
            placeholder="e.g. John Smith"
            className="h-9"
          />
        </div>
      </div>
      <div className="mb-3">
        <FieldLabel dark={dark}>Color</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => {
            const active = value.color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ color: c })}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: c,
                  border: active ? "3px solid var(--color-text)" : "2px solid transparent",
                  cursor: "pointer",
                }}
                aria-label={`Color ${c}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={busy || !value.name}
          className="h-7 text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

// ── Notifications: daily reminder + Google Sheets + browser perm ───

function NotificationsSection({ dark }) {
  const {
    session,
    reminderTime, setReminderTime,
    googleToken, googleTokenExpiry,
    connectGoogleSheets, disconnectGoogleSheets,
    settings, updateSettingsField,
  } = useApp();
  const userId = session?.user?.id;

  const [time, setTime] = useState(reminderTime || "");
  const [error, setError] = useState("");
  const [savingMsg, setSavingMsg] = useState("");
  const [permTick, setPermTick] = useState(0);
  void permTick;

  // Per-type notification prefs (sparse; absence = enabled).
  const [typePrefs, setTypePrefs] = useState({});
  useEffect(() => { listPreferences().then(setTypePrefs); }, []);
  const typeEnabled = (type) => typePrefs[type] !== false;
  const toggleType = async (type) => {
    const next = !typeEnabled(type);
    setTypePrefs((p) => ({ ...p, [type]: next }));
    await setPreferenceEnabled(userId, type, next);
  };

  useEffect(() => { setTime(reminderTime || ""); }, [reminderTime]);

  function flashSaved() { setSavingMsg("Saved"); setTimeout(() => setSavingMsg(""), 1500); }

  async function commitTime(v) {
    if ((v || "") === (reminderTime || "")) return;
    setTime(v || "");
    const { error: err } = await persistUserSettings(userId, { reminder_time: v || null });
    if (err) { setError(err.message); return; }
    setReminderTime(v || "");
    flashSaved();
  }

  const hasNotif = typeof window !== "undefined" && "Notification" in window;
  const granted = hasNotif && Notification.permission === "granted";
  const denied = hasNotif && Notification.permission === "denied";
  async function ask() {
    if (!hasNotif) return;
    await Notification.requestPermission();
    setPermTick((n) => n + 1);
  }

  const googleConnected = googleToken && Date.now() < googleTokenExpiry;

  return (
    <>
      <Toast message={error} dark={dark} tone="err" />
      <Toast message={savingMsg} dark={dark} />

      <SectionCard
        title="Daily reminder"
        hint="Notifies you if no hours have been logged by this time of day."
        dark={dark}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <TimeSelect value={time} onChange={commitTime} />
          {time && (
            <button
              type="button"
              onClick={() => commitTime("")}
              className={`text-xs ${dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
            >
              Clear
            </button>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Lunch break"
        hint="At your lunch time, flip your status to Out to lunch — automatically, or after a quick prompt. It flips back when the break is over."
        dark={dark}
      >
        <div className="flex flex-col gap-3">
          <div className="flex gap-1.5">
            {[["off", "Off"], ["ask", "Ask me"], ["auto", "Automatic"]].map(([v, l]) => {
              const on = (settings?.lunchMode || "off") === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => updateSettingsField({ lunchMode: v })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    on
                      ? dark ? "bg-orange-500/25 text-orange-200" : "bg-orange-100 text-orange-700"
                      : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >{l}</button>
              );
            })}
          </div>
          {(settings?.lunchMode || "off") !== "off" && (
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className={dark ? "text-slate-400" : "text-slate-500"}>At</span>
              <TimeSelect value={settings?.lunchTime || ""} onChange={(v) => updateSettingsField({ lunchTime: v || null })} />
              <span className={dark ? "text-slate-400" : "text-slate-500"}>for</span>
              <select
                value={settings?.lunchDurationMin ?? 60}
                onChange={(e) => updateSettingsField({ lunchDurationMin: Number(e.target.value) })}
                className={`rounded-lg px-2 py-1.5 text-sm border ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`}
              >
                {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Wellbeing reminders"
        hint="Gentle nudges to drink water, move, rest your eyes and more — delivered to your inbox + desktop, only during your active hours."
        dark={dark}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className={dark ? "text-slate-400" : "text-slate-500"}>Active from</span>
            <TimeSelect value={settings?.reminderActiveStart || "09:00"} onChange={(v) => updateSettingsField({ reminderActiveStart: v || null })} />
            <span className={dark ? "text-slate-400" : "text-slate-500"}>to</span>
            <TimeSelect value={settings?.reminderActiveEnd || "17:00"} onChange={(v) => updateSettingsField({ reminderActiveEnd: v || null })} />
          </div>
          <div className={`flex flex-col rounded-xl border divide-y ${dark ? "border-[var(--color-border)] divide-[var(--color-border)]" : "border-slate-200 divide-slate-100"}`}>
            {REMINDERS.map((r) => {
              const cfg = reminderConfig(settings?.wellbeingReminders, r.key);
              const set = (patch) => updateSettingsField({
                wellbeingReminders: { ...(settings?.wellbeingReminders || {}), [r.key]: { on: cfg.on, every: cfg.every, ...patch } },
              });
              return (
                <div key={r.key} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-lg leading-none">{r.emoji}</span>
                  <span className={`flex-1 text-sm font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{r.label}</span>
                  {cfg.on && (
                    <select
                      value={cfg.every}
                      onChange={(e) => set({ every: Number(e.target.value) })}
                      className={`rounded-lg px-2 py-1 text-xs border ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`}
                    >
                      {REMINDER_INTERVALS.map((m) => <option key={m} value={m}>every {m} min</option>)}
                    </select>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cfg.on}
                    onClick={() => set({ on: !cfg.on })}
                    className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${cfg.on ? "bg-[var(--color-accent)]" : dark ? "bg-slate-600" : "bg-slate-300"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${cfg.on ? "translate-x-4" : ""}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Browser notifications"
        hint="So you know when a teammate starts a session or a timer ends."
        dark={dark}
      >
        {granted ? (
          <p className={`inline-flex items-center gap-1.5 text-sm ${dark ? "text-emerald-300" : "text-emerald-700"}`}>
            <Check className="w-4 h-4" /> Enabled
          </p>
        ) : denied ? (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            Blocked by your browser. Re-enable from the site settings (lock icon in the address bar).
          </p>
        ) : (
          <Button onClick={ask} variant="outline" size="sm">
            <Bell className="w-3.5 h-3.5 mr-1.5" /> Allow notifications
          </Button>
        )}
      </SectionCard>

      <SectionCard
        title="What to notify me about"
        hint="Per-type switches. Awareness pings reach your team by default; turn off any you don't want."
        dark={dark}
      >
        <div className="flex flex-col">
          {NOTIFICATION_TYPES.map((t, i) => {
            const on = typeEnabled(t.type);
            return (
              <div
                key={t.type}
                className={`flex items-center justify-between gap-3 py-2.5 ${i > 0 ? "border-t" : ""}`}
                style={{ borderColor: dark ? "var(--color-border)" : "rgb(241,245,249)" }}
              >
                <div className="min-w-0">
                  <div className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{t.label}</div>
                  <div className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{t.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleType(t.type)}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? "bg-[var(--color-accent)]" : dark ? "bg-slate-600" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Quiet hours"
        hint="During quiet hours, desktop pop-ups are silenced — your inbox still collects everything."
        dark={dark}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={settings?.notifDesktopEnabled !== false}
              onClick={() => updateSettingsField({ notifDesktopEnabled: !(settings?.notifDesktopEnabled !== false) })}
              className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${settings?.notifDesktopEnabled !== false ? "bg-[var(--color-accent)]" : dark ? "bg-slate-600" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings?.notifDesktopEnabled !== false ? "translate-x-4" : ""}`} />
            </button>
            <span className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>Desktop pop-up notifications</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className={dark ? "text-slate-400" : "text-slate-500"}>Quiet from</span>
            <TimeSelect value={settings?.notifQuietStart || ""} onChange={(v) => updateSettingsField({ notifQuietStart: v || null })} />
            <span className={dark ? "text-slate-400" : "text-slate-500"}>to</span>
            <TimeSelect value={settings?.notifQuietEnd || ""} onChange={(v) => updateSettingsField({ notifQuietEnd: v || null })} />
            {(settings?.notifQuietStart || settings?.notifQuietEnd) && (
              <button
                type="button"
                onClick={() => updateSettingsField({ notifQuietStart: null, notifQuietEnd: null })}
                className={`text-xs ${dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Google Sheets"
        hint="Connect to export months directly to a new Google Sheet from the Overview page."
        dark={dark}
      >
        {googleConnected ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-sm ${dark ? "text-emerald-300" : "text-emerald-700"}`}>
              <Check className="w-4 h-4" /> Connected
            </span>
            <button
              type="button"
              onClick={disconnectGoogleSheets}
              className={`text-xs ${dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"}`}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <Button onClick={connectGoogleSheets} variant="outline" size="sm">
            Connect Google Sheets
          </Button>
        )}
      </SectionCard>
    </>
  );
}

// ── Data: exports + invoice + imports ──────────────────────────────

function DataSection({ dark }) {
  const {
    exportAllXLSX, exportProfile,
    setShowInvoice,
    importEntriesFromFile, importProfileFromFile,
  } = useApp();
  const entriesRef = useRef(null);
  const profileRef = useRef(null);

  function pickEntries() { entriesRef.current?.click(); }
  function pickProfile() { profileRef.current?.click(); }

  function onEntriesChange(e) {
    const file = e.target.files?.[0];
    if (file) importEntriesFromFile(file);
    e.target.value = "";
  }
  function onProfileChange(e) {
    const file = e.target.files?.[0];
    if (file) importProfileFromFile(file);
    e.target.value = "";
  }

  return (
    <>
      <SectionCard title="Export" hint="Download a full backup of your time entries or your account profile." dark={dark}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportAllXLSX} variant="outline" size="sm">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> All entries (XLSX)
          </Button>
          <Button onClick={() => setShowInvoice(true)} variant="outline" size="sm">
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Generate invoice (PDF)
          </Button>
          <Button onClick={exportProfile} variant="outline" size="sm">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Profile (JSON)
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Import"
        hint="Restore from a previous backup. Imports merge — they don't replace existing data."
        dark={dark}
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={pickEntries} variant="outline" size="sm">
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Load entries.json…
          </Button>
          <Button onClick={pickProfile} variant="outline" size="sm">
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Load profile.json…
          </Button>
        </div>
        {/* Hidden file inputs — previously hosted by LogPage; on the
            Settings page we own them locally so import works without
            navigating to /log first. */}
        <input
          ref={entriesRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={onEntriesChange}
        />
        <input
          ref={profileRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={onProfileChange}
        />
      </SectionCard>
    </>
  );
}
