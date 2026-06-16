import { Play, Pause, RotateCcw } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Hero playback controls.
//
//   slot="all"     → buttons + Take Leader/alt-break label stacked (default)
//   slot="buttons" → Play/Pause + Reset only (used when the surface
//                    grid-aligns the buttons with the clock numerals)
//   slot="extras"  → Take Leader + alt-break label only (placed in
//                    the cell beneath the buttons)
//
//   sm  → 40px play button, 16px icons
//   md  → 56px play, 18px icons  (rail, floating, popover)
//   lg  → 72px play, 22px icons  (/pomodoro page)
const SIZES = {
  sm: { play: "w-10 h-10", playIcon: "w-4 h-4", resetIcon: "w-4 h-4", labelText: "text-[10px]" },
  md: { play: "w-14 h-14", playIcon: "w-5 h-5", resetIcon: "w-4 h-4", labelText: "text-[11px]" },
  lg: { play: "w-[72px] h-[72px]", playIcon: "w-7 h-7", resetIcon: "w-5 h-5", labelText: "text-xs" },
};

export default function TimerControls({ size = "md", slot = "all", onTakeLeader }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { isSynced, isController, pendingAction, canControl,
          isRunning, pendingMode, mode, secondsLeft, durations,
          toggleRun, resetTimer, skipTransition, switchAlternateBreak } = usePomodoro();

  const isInTransition = !!pendingMode;
  const locked = !!pendingAction;
  const disabled = !canControl || locked;
  const isBreak = (isInTransition ? pendingMode : mode) !== "work";
  const total = durations[mode] || 0;
  const safeSeconds = Number.isFinite(secondsLeft) ? secondsLeft : 0;
  const showResume = safeSeconds < total;

  const sz = SIZES[size] || SIZES.md;
  const playBg = isBreak
    ? "bg-[var(--color-break)] hover:bg-[var(--color-break-hover)]"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]";

  const showAlternateBreak = !isInTransition && (mode === "shortBreak" || mode === "longBreak");
  const alternateBreakLabel = mode === "shortBreak"
    ? "Take long break instead"
    : "Take short break instead";
  const showTakeLeader = isSynced && !isController && onTakeLeader;

  const playButton = isInTransition ? (
    <button
      type="button"
      onClick={skipTransition}
      disabled={disabled}
      className={`${sz.play} rounded-full text-white shadow-lg inline-flex items-center justify-center transition-all ${
        disabled ? "opacity-40 cursor-default" : ""
      } ${playBg}`}
      title="Start now"
    >
      <Play className={`${sz.playIcon} ml-0.5`} fill="currentColor" />
    </button>
  ) : (
    <button
      type="button"
      onClick={toggleRun}
      disabled={disabled}
      className={`${sz.play} rounded-full text-white shadow-lg inline-flex items-center justify-center transition-all ${
        disabled ? "opacity-40 cursor-default" : ""
      } ${playBg}`}
      title={isRunning ? "Pause" : showResume ? "Resume" : "Start"}
    >
      {isRunning
        ? <Pause className={sz.playIcon} fill="currentColor" />
        : <Play className={`${sz.playIcon} ml-0.5`} fill="currentColor" />}
    </button>
  );

  const resetButton = (
    <button
      type="button"
      onClick={resetTimer}
      disabled={disabled}
      title="Reset"
      className={`p-1.5 rounded-full transition-colors ${
        disabled ? "opacity-30 cursor-default" : ""
      } ${
        dark
          ? "text-slate-400 hover:text-slate-200 hover:bg-[var(--color-surface-raised)]"
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
      }`}
    >
      <RotateCcw className={sz.resetIcon} />
    </button>
  );

  const extras = (showTakeLeader || showAlternateBreak) ? (
    <div className="flex flex-col items-end gap-1 leading-none">
      {showTakeLeader && (
        <button
          type="button"
          onClick={onTakeLeader}
          className={`${sz.labelText} font-semibold transition-colors ${
            dark ? "text-slate-400 hover:text-[var(--color-accent)]" : "text-slate-500 hover:text-[var(--color-accent)]"
          }`}
        >
          Take Leader
        </button>
      )}
      {showAlternateBreak && (
        <button
          type="button"
          onClick={switchAlternateBreak}
          disabled={disabled || isInTransition}
          className={`${sz.labelText} font-semibold text-[var(--color-break)] hover:text-[var(--color-break-hover)] ${
            disabled || isInTransition ? "opacity-40 cursor-default" : ""
          }`}
        >
          {alternateBreakLabel}
        </button>
      )}
    </div>
  ) : null;

  if (slot === "buttons") {
    return (
      <div className="flex items-center gap-3">
        {playButton}
        {resetButton}
      </div>
    );
  }
  if (slot === "extras") {
    return extras;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {playButton}
        {resetButton}
      </div>
      {extras}
    </div>
  );
}
