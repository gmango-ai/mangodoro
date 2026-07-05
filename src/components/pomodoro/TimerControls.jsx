import { Play, Pause, RotateCcw, Lock } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Hero playback controls.
//
// Layout: [ ↺ small circle ] [ ▶ big accent circle ]
//
//   Synced + not controller → the big circle becomes a non-interactive
//   LOCK icon. Reset is also locked. The mockup makes "you cannot
//   control this" unmistakable instead of just dimming the buttons.
//
//   sm  → 40/48px circles
//   md  → 48/64px circles (rail, floating, popover)
//   lg  → 56/80px circles (/pomodoro page)
const SIZES = {
  sm: { reset: "w-10 h-10", play: "w-12 h-12", resetIcon: "w-4 h-4", playIcon: "w-5 h-5" },
  md: { reset: "w-12 h-12", play: "w-16 h-16", resetIcon: "w-4 h-4", playIcon: "w-6 h-6" },
  lg: { reset: "w-14 h-14", play: "w-20 h-20", resetIcon: "w-5 h-5", playIcon: "w-7 h-7" },
};

export default function TimerControls({ size = "md" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { isSynced, isController, pendingAction, canControl,
          isRunning, pendingMode, mode, secondsLeft, durations,
          toggleRun, resetTimer, skipTransition } = usePomodoro();

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

  const resetBg = dark
    ? "bg-[var(--color-surface-raised)] text-slate-400 hover:text-slate-200"
    : "bg-slate-100 text-slate-500 hover:text-slate-700";

  // Lock state: synced but not controller. Renders both as visually-
  // present "controls" so the layout doesn't shift between leader and
  // follower views — just indicates control isn't yours.
  const showLock = isSynced && !isController;

  if (showLock) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          title="Only the leader can reset"
          className={`${sz.reset} rounded-full inline-flex items-center justify-center opacity-50 cursor-default ${resetBg}`}
        >
          <RotateCcw className={sz.resetIcon} />
        </button>
        <div
          title="The session leader controls the timer"
          className={`${sz.play} rounded-full inline-flex items-center justify-center ${
            dark ? "bg-[var(--color-surface-raised)] text-slate-400" : "bg-slate-100 text-slate-500"
          }`}
        >
          <Lock className={sz.playIcon} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => resetTimer()}
        disabled={disabled}
        title="Reset"
        className={`${sz.reset} rounded-full inline-flex items-center justify-center transition-colors ${
          disabled ? "opacity-30 cursor-default" : ""
        } ${resetBg}`}
      >
        <RotateCcw className={sz.resetIcon} />
      </button>
      {isInTransition ? (
        <button
          type="button"
          onClick={() => skipTransition()}
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
          onClick={() => toggleRun()}
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
      )}
    </div>
  );
}
