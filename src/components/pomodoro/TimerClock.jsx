import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { MODE_LABELS } from "../../pomodoro/constants";

// Big numeric clock. Left-aligned mm:ss with the mode label below.
// No SVG ring — the visual weight comes from the typography itself.
//
//   sm  → popover (380px)
//   md  → office rail, floating overlay
//   lg  → /pomodoro page
//
// `slot` lets the surface place the numbers and the mode label in
// separate grid cells when it needs precise alignment with the play
// button cluster on the right. By default both render stacked.
//
//   slot="all"     → numbers + label (default)
//   slot="numbers" → numerals only
//   slot="label"   → mode label only
//
// Defensive against secondsLeft being undefined/NaN — the popover hit
// that on cold load when the sync session row hadn't arrived yet,
// surfacing as "NaN:NaN" briefly. Clamped to 0 so the clock reads
// "00:00" until real data lands.
const SIZES = {
  sm: { time: "text-5xl", label: "text-[11px] mt-1" },
  md: { time: "text-6xl", label: "text-xs mt-1" },
  lg: { time: "text-7xl sm:text-8xl", label: "text-sm mt-1.5" },
};

export default function TimerClock({ size = "md", slot = "all" }) {
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

  if (slot === "numbers") {
    return (
      <span className={`${timeCls} font-mono font-bold tabular-nums leading-none ${numberColor}`}>
        {mins}:{secs}
      </span>
    );
  }
  if (slot === "label") {
    return (
      <span className={`${labelCls} font-semibold uppercase tracking-wider ${accentLabel} leading-none`}>
        {displayLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <span className={`${timeCls} font-mono font-bold tabular-nums leading-none ${numberColor}`}>
        {mins}:{secs}
      </span>
      <span className={`${labelCls} font-semibold uppercase tracking-wider ${accentLabel}`}>
        {displayLabel}
      </span>
    </div>
  );
}
