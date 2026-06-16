import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { WORK_SESSIONS_PER_CYCLE } from "../../pomodoro/constants";

// Cycle-progress dots. Used to render with a "2/4" count label next
// to them; the redesign drops that label since the dots themselves
// carry the same info. Left-aligned so they line up under the clock
// numbers in the hero row.
export default function SessionDots({ align = "start" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { sessions } = usePomodoro();
  const filled = Math.min(sessions, WORK_SESSIONS_PER_CYCLE);
  const justify = align === "center" ? "justify-center" : "justify-start";

  return (
    <div className={`flex items-center gap-1.5 ${justify}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full transition-colors ${
            i < filled
              ? dark ? "bg-slate-200" : "bg-slate-800"
              : dark ? "bg-slate-700" : "bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}
