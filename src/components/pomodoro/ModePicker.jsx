import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

const MODES = [
  ["work", "FOCUS"],
  ["shortBreak", "SHORT"],
  ["longBreak", "LONG"],
];

// Text-only tabs with an accent underline on the active mode. Replaces
// the previous rounded-pill background that competed with the clock
// for visual weight — at this density the labels alone read clearly
// and the active state pops from the underline + color shift.
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
    <div className="flex items-center gap-5">
      {MODES.map(([m, label]) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            disabled={disabled}
            className={`relative text-xs font-bold tracking-wider transition-colors pb-1 ${
              disabled ? "cursor-default opacity-60" : ""
            } ${
              active
                ? "text-[var(--color-accent)]"
                : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {label}
            {active && (
              <span
                aria-hidden
                className="absolute left-0 right-0 -bottom-0.5 h-0.5 rounded-full bg-[var(--color-accent)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
