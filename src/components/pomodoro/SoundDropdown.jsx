import { useEffect, useRef, useState } from "react";
import { Volume2, ChevronDown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import {
  POMODORO_SOUND_PRESETS,
  loadPomodoroSoundSettings,
  savePomodoroSoundSettings,
} from "../../lib/pomodoroSound";
import SoundLibrary from "../SoundLibrary";

// Inline labeled trigger row + rich popover. The trigger looks like
// a single labeled control:
//
//   🔊 Alert Sound                 [ Soft Bell ▾ ]
//
// Click → expands the full SoundLibrary in a panel below (categories,
// focus vs break selection, custom user/team sounds). Best of both:
// clean surface chrome on the closed state, the rich library when the
// user actually wants to pick.
export default function SoundDropdown({ label = "Alert Sound" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings } = useApp();
  const { teamSounds } = useTeam();
  const { isSynced, isController } = usePomodoro();
  const [open, setOpen] = useState(false);
  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const update = (patch) => {
    setSoundSettings((prev) => {
      const next = { ...prev, ...patch };
      savePomodoroSoundSettings(next);
      return next;
    });
  };

  // The chip label resolves the focus-end preset to a friendly name.
  // Most users want one sound for everything; if they've configured
  // focus and break separately, the chip still shows the focus one
  // (the library expands the full picture when they open it).
  const currentId = soundSettings.workEndPreset || "chime";
  const currentLabel =
    POMODORO_SOUND_PRESETS.find((p) => p.id === currentId)?.label || "Default";

  const effectiveLabel = isSynced && !isController ? `My ${label}` : label;
  const userCustomSounds = settings?.customSounds || [];
  const teamCustomSounds = teamSounds || [];

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <Volume2 className={`w-4 h-4 ${dark ? "text-slate-400" : "text-slate-500"}`} />
          <span className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {effectiveLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-full text-sm font-semibold transition-colors ${
            dark
              ? "border border-[var(--color-border)] bg-[var(--color-surface)] text-slate-100 hover:border-[var(--color-accent)]"
              : "border border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]"
          }`}
        >
          {currentLabel}
          <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className={`rounded-2xl border p-3 space-y-3 ${
          dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "border-slate-200 bg-slate-50"
        }`}>
          <SoundLibrary
            mode="pick"
            userSounds={userCustomSounds}
            teamSounds={teamCustomSounds}
            soundSettings={soundSettings}
            onSelectFocus={(presetId) => update({ workEndPreset: presetId })}
            onSelectBreak={(presetId) => update({ breakEndPreset: presetId })}
            onUpdateSettings={update}
          />
        </div>
      )}
    </div>
  );
}
