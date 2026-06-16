import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { WORK_SESSIONS_PER_CYCLE } from "../../pomodoro/constants";

// 4 dots showing where the user is in their pomodoro cycle. Cheap
// glance-able feedback for "almost time for a long break."
export default function SessionDots() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { sessions } = usePomodoro();
  const filled = Math.min(sessions, WORK_SESSIONS_PER_CYCLE);

  return (
    <div className="flex items-center justify-center gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-colors ${
            i < filled
              ? "bg-[var(--color-accent)]"
              : dark ? "bg-slate-700" : "bg-slate-200"
          }`}
        />
      ))}
      <span className={`text-[11px] ml-1 font-mono ${dark ? "text-slate-500" : "text-slate-400"}`}>
        {filled}/{WORK_SESSIONS_PER_CYCLE}
      </span>
    </div>
  );
}
