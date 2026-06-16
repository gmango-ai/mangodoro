import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { MODE_LABELS, TRANSITION_SECONDS } from "../../pomodoro/constants";

// Big-clock display: numbers + progress ring. Pure presentation —
// reads from usePomodoro(). Size is configurable so the same
// component works on the /pomodoro page (large), the office rail
// (medium), and the menubar popover (small).
//
// Sizes map to a target diameter in px. The SVG uses a fixed
// viewBox so the ring stays crisp at any container size.
const SIZES = {
  sm: { box: "w-28 h-28", time: "text-2xl", label: "text-[10px]" },
  md: { box: "w-36 h-36", time: "text-3xl", label: "text-[11px]" },
  lg: { box: "w-48 h-48", time: "text-5xl", label: "text-xs" },
};

export default function TimerClock({ size = "md" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const {
    mode, secondsLeft, isRunning, durations, pendingMode,
  } = usePomodoro();

  const { box, time: timeCls, label: labelCls } = SIZES[size] || SIZES.md;

  const isInTransition = !!pendingMode;
  const displayMode = isInTransition ? pendingMode : mode;
  const total = isInTransition ? TRANSITION_SECONDS : durations[mode];
  const progress = isInTransition
    ? (TRANSITION_SECONDS - secondsLeft) / TRANSITION_SECONDS
    : secondsLeft === total ? 0 : (total - secondsLeft) / total;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const isBreak = displayMode !== "work";
  // Break mode reads from --color-break (the split-complementary
  // derived from the user's accent — see src/lib/accent.js).
  const ringStroke = isBreak ? "var(--color-break)" : "var(--color-accent)";
  const timeColor = isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]";

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const displayLabel = isInTransition
    ? `${MODE_LABELS[pendingMode]} in…`
    : MODE_LABELS[mode];

  return (
    <div className={`relative ${box} mx-auto`}>
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="6"
          className={dark ? "stroke-slate-800" : "stroke-slate-100"}
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            stroke: ringStroke,
            transition: isRunning ? "stroke-dashoffset 1s linear" : "none",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-1">
        <span className={`${timeCls} font-mono font-bold tabular-nums leading-none ${timeColor}`}>
          {mins}:{secs}
        </span>
        <span className={`${labelCls} mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {displayLabel}
        </span>
      </div>
    </div>
  );
}
