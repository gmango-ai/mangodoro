import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { MODE_LABELS } from "../../pomodoro/constants";

// Big numeric clock. Left-aligned mm:ss with the mode label below.
// No SVG ring — the visual weight comes from the typography itself,
// which scales cleanly across surfaces.
//
//   sm  → popover (380px)
//   md  → office rail, floating overlay
//   lg  → /pomodoro page
//
// Defensive against secondsLeft being undefined/NaN — the floating
// popover hit that on cold load when the sync session row hadn't
// arrived yet, surfacing as "NaN:NaN" briefly. We clamp to 0 so the
// clock reads "00:00" until real data lands.
const SIZES = {
  sm: { time: "text-5xl", label: "text-[11px] mt-1" },
  md: { time: "text-6xl", label: "text-xs mt-1" },
  lg: { time: "text-7xl sm:text-8xl", label: "text-sm mt-1.5" },
};

export default function TimerClock({ size = "md", showLabel = true }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, pendingMode } = usePomodoro();

  const { time: timeCls, label: labelCls } = SIZES[size] || SIZES.md;

  const isInTransition = !!pendingMode;
  const safeSeconds = Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : 0;
  const mins = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const secs = String(safeSeconds % 60).padStart(2, "0");

  const isBreak = (isInTransition ? pendingMode : mode) !== "work";
  const numberColor = dark ? "text-slate-100" : "text-slate-900";
  const accentLabel = isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]";
  const displayLabel = isInTransition
    ? `${MODE_LABELS[pendingMode]} in…`
    : MODE_LABELS[mode];

  return (
    <div className="flex flex-col items-start">
      <span className={`${timeCls} font-mono font-bold tabular-nums leading-none ${numberColor}`}>
        {mins}:{secs}
      </span>
      {showLabel && (
        <span className={`${labelCls} font-semibold uppercase tracking-wider ${accentLabel}`}>
          {displayLabel}
        </span>
      )}
    </div>
  );
}
