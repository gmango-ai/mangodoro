import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

const MODES = [
  ["work", "Focus"],
  ["shortBreak", "Short"],
  ["longBreak", "Long"],
];

// Pill-tab mode picker. Active mode renders as a solid accent pill;
// inactive modes are flat text in a muted color. The whole strip
// sits inside a faint container so the pill reads as a "selected"
// state rather than a free-floating button.
export default function ModePicker() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const {
    mode, pendingMode, pendingAction, canControl, switchMode,
  } = usePomodoro();

  const isInTransition = !!pendingMode;
  const locked = !!pendingAction;
  const disabled = !canControl || locked || isInTransition;

  return (
    <div className={`inline-flex p-1 rounded-full w-full ${
      dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
    }`}>
      {MODES.map(([m, label]) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            disabled={disabled}
            className={`flex-1 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
              disabled ? "cursor-default opacity-60" : ""
            } ${
              active
                ? "bg-[var(--color-accent)] text-white shadow-sm"
                : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
