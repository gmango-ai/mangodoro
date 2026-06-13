import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Settings as SettingsIcon, User, Palette, Timer, Clock,
  Briefcase, Bell, Database, ExternalLink, Check, Sun, Moon, Sparkles,
} from "lucide-react";
import { ACCENTS } from "../lib/accent";

// Settings as a real page (was a modal). Left sidebar of sections,
// right pane renders the section. Each section saves what it owns —
// no global Save button, so picking a theme or color commits instantly.
//
// Sections kept narrow on purpose; complex flows (projects, templates)
// link out to dedicated screens rather than cramming into the rail.
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
        <div className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-[var(--color-accent-light)]"}`}>
          <SettingsIcon className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-[var(--color-accent)]"}`} />
        </div>
        <h1 className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
          Settings
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        {/* Sidebar */}
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
                    ? dark
                      ? "bg-cyan-500/15 text-cyan-200 font-semibold"
                      : "bg-[var(--color-accent-light)] text-[var(--color-accent)] font-semibold"
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

        {/* Content */}
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

// ── Section components ─────────────────────────────────────────────

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

function ProfileSection({ dark }) {
  const { settings, updateSettingsField } = useApp();
  const [nameDraft, setNameDraft] = useState(settings.name || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await updateSettingsField({ name: nameDraft.trim() });
    setBusy(false);
  }

  return (
    <>
      <SectionCard title="Your profile" hint="What teammates see in shared sessions and retros." dark={dark}>
        <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Display name
        </label>
        <div className="flex gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
            placeholder="e.g. Jacob"
            className="flex-1"
          />
          <Button onClick={save} disabled={busy || nameDraft === (settings.name || "")}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Account" hint="Avatar, custom alarm sound, and account-level controls." dark={dark}>
        <Link
          to="/account"
          className={`inline-flex items-center gap-2 text-sm font-semibold ${
            dark ? "text-cyan-300 hover:text-cyan-200" : "text-[var(--color-accent)] hover:underline"
          }`}
        >
          Go to account page <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </SectionCard>
    </>
  );
}

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
                    ? dark
                      ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                      : "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
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
        hint="Used on buttons, links, focus rings, and other highlights. Saves immediately."
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
                    ? dark ? "border-cyan-400 bg-cyan-500/10" : "border-slate-800 bg-slate-50"
                    : "border-transparent hover:border-slate-300 dark:hover:border-slate-600"
                }`}
                aria-label={a.label}
                aria-pressed={active}
              >
                <span
                  className="w-10 h-10 rounded-full relative"
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
          Heads-up: some surfaces still use the original teal/cyan palette. Migrating those is a bigger refactor we'll roll in over time.
        </p>
      </SectionCard>
    </>
  );
}

function PomodoroSection({ dark }) {
  return (
    <SectionCard title="Pomodoro" hint="Sound, durations, and timer behavior live with the timer itself." dark={dark}>
      <p className={`text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
        Pop-out and sound settings are accessible from the timer's gear in the top of the timer card.
      </p>
      <p className={`text-xs mt-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
        Custom alarm sound: <Link to="/account" className={`underline ${dark ? "text-cyan-300" : "text-[var(--color-accent)]"}`}>Account page</Link>
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
        The full project + template editor is currently in the legacy settings dialog. Use the Settings cog in the timer card to open it.
      </p>
      <p className={`text-[11px] mt-2 italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
        Moving to this page in a follow-up.
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
