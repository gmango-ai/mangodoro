import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

const MODES = [
  ["work", "Focus"],
  ["shortBreak", "Short"],
  ["longBreak", "Long"],
];

// Three-tab mode picker. Disabled while a pending action is queued,
// while a transition is in flight, or when the local user isn't the
// controller of a synced session. The same gating logic was duplicated
// across the timer + popover — now it lives in one place.
export default function ModePicker({ size = "md" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const {
    mode, pendingMode, pendingAction, canControl, switchMode,
  } = usePomodoro();

  const isInTransition = !!pendingMode;
  const locked = !!pendingAction;
  const disabled = !canControl || locked || isInTransition;

  const padding = size === "sm" ? "py-1" : "py-1.5";
  const text = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className={`flex rounded-lg p-0.5 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"}`}>
      {MODES.map(([m, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => switchMode(m)}
          disabled={disabled}
          className={`flex-1 ${padding} rounded-md ${text} font-semibold transition-all ${
            disabled ? "cursor-default opacity-60" : ""
          } ${
            mode === m
              ? dark
                ? "bg-slate-700 text-white"
                : "bg-white text-slate-800 shadow-sm"
              : dark
                ? "text-slate-500 hover:text-slate-300"
                : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
