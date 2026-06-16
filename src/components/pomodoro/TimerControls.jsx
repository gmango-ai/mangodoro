import { Play, Pause, RotateCcw } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Hero playback controls: one big circular Play/Pause button + a
// muted reset icon to its right. "Take Leader" appears beneath the
// reset icon when the user is synced but isn't the current controller
// — onTakeLeader fires the takeControl RPC. The duration-edit
// affordance moved out of this row (will reappear in a settings menu
// in a follow-up); pulling it out keeps the hero row tight and
// matches the redesign mockup.
//
//   sm  → 40px play button, 16px icons
//   md  → 56px play, 18px icons  (rail, floating, popover)
//   lg  → 72px play, 22px icons  (/pomodoro page)
const SIZES = {
  sm: { play: "w-10 h-10", playIcon: "w-4 h-4", resetIcon: "w-4 h-4", labelText: "text-[10px]" },
  md: { play: "w-14 h-14", playIcon: "w-5 h-5", resetIcon: "w-4 h-4", labelText: "text-[11px]" },
  lg: { play: "w-[72px] h-[72px]", playIcon: "w-7 h-7", resetIcon: "w-5 h-5", labelText: "text-xs" },
};

export default function TimerControls({ size = "md", onTakeLeader }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { isSynced, isController, pendingAction, canControl,
          isRunning, pendingMode, mode, secondsLeft, durations,
          toggleRun, resetTimer, skipTransition, switchAlternateBreak } = usePomodoro();
  useSyncSession();

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

  // Synced + not controller → show "Take Leader" tap label beneath
  // the reset button. The label fires takeControl via the prop.
  const showTakeLeader = isSynced && !isController && onTakeLeader;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {isInTransition ? (
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
        )}
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
      </div>

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
          className={`text-[11px] font-semibold text-[var(--color-break)] hover:text-[var(--color-break-hover)] ${
            disabled || isInTransition ? "opacity-40 cursor-default" : ""
          }`}
        >
          {alternateBreakLabel}
        </button>
      )}
    </div>
  );
}
