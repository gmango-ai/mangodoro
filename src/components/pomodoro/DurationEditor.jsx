import { useState } from "react";
import { Check } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { MODE_LABELS } from "../../pomodoro/constants";

// Inline duration editor. Quick presets + numeric input. Two save
// modes: "apply" (this cycle only) and "apply + save as default".
// The pomodoro engine handles confirm-before-discard if the timer's
// already mid-cycle.
export default function DurationEditor({ onClose }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, durations, applyCustomDuration } = usePomodoro();
  const [draft, setDraft] = useState(() => String(Math.max(1, Math.round(durations[mode] / 60))));

  const isBreak = mode !== "work";
  const startBtnCls = isBreak
    ? "bg-[var(--color-break)] hover:bg-[var(--color-break-hover)]"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]";

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-slate-50 border-slate-200"
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Set {MODE_LABELS[mode]} length
        </span>
        <div className="flex gap-1">
          {[5, 10, 15, 25, 45].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDraft(String(m))}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-700" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          max="240"
          step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") { applyCustomDuration(draft, false); onClose?.(); }
            if (e.key === "Escape") onClose?.();
          }}
          className={`flex-1 h-8 px-2 rounded-md border text-sm font-mono ${
            dark
              ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        />
        <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>min</span>
        <button
          type="button"
          onClick={() => { applyCustomDuration(draft, false); onClose?.(); }}
          title="Apply to this cycle"
          className={`h-8 px-3 rounded-md text-xs font-bold text-white ${startBtnCls}`}
        >
          <Check className="w-3.5 h-3.5 inline" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => { applyCustomDuration(draft, true); onClose?.(); }}
        className={`w-full text-[10px] font-semibold py-1 rounded transition-colors ${
          dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-700/50" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-200/60"
        }`}
      >
        Apply &amp; save as default
      </button>
    </div>
  );
}
