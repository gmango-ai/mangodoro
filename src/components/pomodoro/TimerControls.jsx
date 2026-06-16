import { useState } from "react";
import { RotateCcw, Pencil } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import DurationEditor from "./DurationEditor";

// Reset / Start-Pause-Resume / Duration-Edit. The duration editor
// pops open below the controls (passing showDurationEditor=true on
// state, off otherwise). The "Start now" alternative button is
// rendered when the timer is in a transition (auto-cycle countdown).
//
// allowDurationEdit lets surfaces hide the duration affordance — the
// menubar popover, for example, has no room for the inline editor.
export default function TimerControls({
  allowDurationEdit = true,
  showSessionDots = false,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const {
    mode, secondsLeft, isRunning, durations, pendingMode, pendingAction,
    canControl, toggleRun, resetTimer, skipTransition, switchAlternateBreak,
  } = usePomodoro();

  const [editingDuration, setEditingDuration] = useState(false);

  const isInTransition = !!pendingMode;
  const locked = !!pendingAction;
  const disabled = !canControl || locked;
  const isBreak = (isInTransition ? pendingMode : mode) !== "work";
  const total = durations[mode];
  const startLabel = isRunning ? "Pause" : secondsLeft < total ? "Resume" : "Start";

  const startBtnCls = isBreak
    ? "bg-[var(--color-break)] hover:bg-[var(--color-break-hover)] shadow-[var(--color-break)]/30"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] shadow-[var(--color-accent)]/30";

  const showAlternateBreak = !isInTransition && (mode === "shortBreak" || mode === "longBreak");
  const alternateBreakLabel = mode === "shortBreak"
    ? "Take long break instead"
    : "Take short break instead";

  return (
    <div className="flex flex-col items-center gap-2">
      {isInTransition ? (
        <button
          type="button"
          onClick={skipTransition}
          disabled={disabled}
          className={`px-7 py-2 rounded-full text-sm font-bold text-white shadow-lg transition-all ${
            disabled ? "opacity-40 cursor-default" : ""
          } ${startBtnCls}`}
        >
          Start now
        </button>
      ) : (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={resetTimer}
            disabled={disabled}
            title="Reset"
            className={`p-2 rounded-full transition-colors ${
              disabled ? "opacity-30 cursor-default" : ""
            } ${
              dark
                ? "text-slate-500 hover:text-slate-300 hover:bg-[var(--color-surface-raised)]"
                : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            }`}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleRun}
            disabled={disabled}
            className={`px-7 py-2 rounded-full text-sm font-bold text-white shadow-lg transition-all ${
              disabled ? "opacity-40 cursor-default" : ""
            } ${startBtnCls}`}
          >
            {startLabel}
          </button>
          {allowDurationEdit && (
            <button
              type="button"
              onClick={() => setEditingDuration((v) => !v)}
              disabled={disabled}
              title="Set duration"
              className={`p-2 rounded-full transition-colors ${
                disabled ? "opacity-30 cursor-default" : ""
              } ${
                editingDuration
                  ? dark ? "text-[var(--color-accent)] bg-[var(--color-surface-raised)]" : "text-[var(--color-accent)] bg-slate-100"
                  : dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-[var(--color-surface-raised)]"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>
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

      {allowDurationEdit && editingDuration && canControl && (
        <div className="w-full">
          <DurationEditor onClose={() => setEditingDuration(false)} />
        </div>
      )}
    </div>
  );
}
