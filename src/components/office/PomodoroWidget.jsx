import { Clock, Play, Pause, RotateCcw, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { openPomodoroSurface } from "../../lib/pomodoroSurface";
import { formatClock } from "../../lib/utils";
import WidgetSection from "./WidgetSection";

// Compact pomodoro controls for the WidgetsSidebar.
//
// The pomodoro state is already session-aware (when the user is in a
// sync session, mode/secondsLeft/isRunning flow from sync_sessions and
// only the leader/controller can mutate). We mirror that with
// `canControl` from the context — non-controllers see the readout but
// not the buttons.
//
// "Expand" opens the floating PomodoroSurface for the full controls
// (custom durations, sync settings, mode picker, etc).
export default function PomodoroWidget({ dark }) {
  const {
    mode, secondsLeft, isRunning, sessions, canControl,
    toggleRun, resetTimer,
  } = usePomodoro();

  const onBreak = mode !== "work";
  const clock = formatClock(secondsLeft, { padMinutes: true });
  const modeLabel = mode === "work"
    ? "Work"
    : mode === "longBreak" ? "Long break" : "Short break";

  const maximizeAction = (
    <button
      type="button"
      onClick={openPomodoroSurface}
      aria-label="Open full pomodoro"
      title="Open full pomodoro"
      className={`inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-0.5 rounded-md transition-colors ${
        dark ? "hover:bg-[var(--color-surface)] hover:text-slate-200" : "hover:bg-white hover:text-slate-700"
      }`}
    >
      <Maximize2 className="w-5 h-5 sm:w-3 sm:h-3" />
    </button>
  );

  return (
    <WidgetSection id="pomodoro" icon={Clock} title="Pomodoro" dark={dark} action={maximizeAction}>
      <div className="space-y-2">
        <button
          type="button"
          onClick={openPomodoroSurface}
          title="Open pomodoro controls"
          className="w-full text-left"
        >
          <div
            className="text-3xl font-display font-bold tabular-nums tracking-tight"
            style={{ color: onBreak ? "var(--color-break)" : "var(--color-accent)" }}
          >
            {clock}
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className={`text-[10px] uppercase tracking-wider font-bold ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              {modeLabel}
            </span>
            <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Round {sessions + 1}
            </span>
          </div>
        </button>

        {canControl ? (
          <div className="flex gap-1.5">
            <Button
              onClick={() => toggleRun()}
              size="sm"
              variant={isRunning ? "outline" : "default"}
              className="flex-1 h-11 sm:h-8"
            >
              {isRunning ? (
                <><Pause className="w-3.5 h-3.5 mr-1.5" /> Pause</>
              ) : (
                <><Play className="w-3.5 h-3.5 mr-1.5" /> Start</>
              )}
            </Button>
            <Button
              onClick={() => resetTimer()}
              size="sm"
              variant="outline"
              title="Reset timer"
              aria-label="Reset timer"
              className="h-11 w-11 sm:h-8 sm:w-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            The session controller drives the timer for everyone.
          </p>
        )}
      </div>
    </WidgetSection>
  );
}
