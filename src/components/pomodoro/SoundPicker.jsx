import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import {
  loadPomodoroSoundSettings,
  savePomodoroSoundSettings,
} from "../../lib/pomodoroSound";
import SoundLibrary from "../SoundLibrary";

// Collapsible sound + behavior section. Wraps SoundLibrary and the
// 5-second countdown toggle. Settings persist via the existing
// pomodoroSound.js helpers — moving them to user_settings (so a
// sound change on one device follows the user everywhere) is the
// natural next step but lives in a follow-up because it touches DB.
//
// `initialOpen` lets surfaces decide whether the picker is open by
// default — usually closed to keep the timer compact.
export default function SoundPicker({ initialOpen = false }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings } = useApp();
  const { teamSounds } = useTeam();
  const { autoTransition, setAutoTransition } = usePomodoro();

  const userCustomSounds = settings?.customSounds || [];
  const teamCustomSounds = teamSounds || [];

  const [open, setOpen] = useState(initialOpen);
  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());

  const update = (patch) => {
    setSoundSettings((prev) => {
      const next = { ...prev, ...patch };
      savePomodoroSoundSettings(next);
      return next;
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-center gap-1 w-full py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
          dark
            ? "text-slate-500 hover:bg-[var(--color-surface-raised)] hover:text-slate-300"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        Sound
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="space-y-4 mt-2">
          <SoundLibrary
            mode="pick"
            userSounds={userCustomSounds}
            teamSounds={teamCustomSounds}
            soundSettings={soundSettings}
            onSelectFocus={(presetId) => update({ workEndPreset: presetId })}
            onSelectBreak={(presetId) => update({ breakEndPreset: presetId })}
            onUpdateSettings={update}
          />
          <label
            className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
              dark
                ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300"
                : "bg-slate-50 border-slate-200 text-slate-600"
            }`}
          >
            <span>5-second countdown before breaks</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoTransition}
              onClick={() => setAutoTransition(!autoTransition)}
              className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
                autoTransition ? "bg-[var(--color-accent)]" : dark ? "bg-slate-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoTransition ? "translate-x-4" : ""
                }`}
              />
            </button>
          </label>
        </div>
      )}
    </div>
  );
}
