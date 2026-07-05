import { useContext } from "react";
import { Play, Pause } from "lucide-react";
import { PomodoroContext } from "../../pomodoro/PomodoroContext";
import { openPomodoroSurface } from "../../lib/pomodoroSurface";

// Compact pomodoro clock for the nav bar. Moved out of the room header so the
// timer is glanceable on every page, not just inside a room. Click opens the
// full PomodoroSurface for controls. Reads the raw PomodoroContext (not the
// throwing usePomodoro) so it renders nothing — rather than crashing the nav —
// if ever mounted outside a provider.
export default function NavPomodoroClock() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) return null;
  const { mode, secondsLeft, isRunning } = ctx;

  const safe = Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : 0;
  const mins = String(Math.floor(safe / 60)).padStart(2, "0");
  const secs = String(safe % 60).padStart(2, "0");
  const onBreak = !!mode && mode !== "work";

  return (
    <button
      type="button"
      onClick={openPomodoroSurface}
      title="Open pomodoro controls"
      aria-label={`Pomodoro ${isRunning ? "running" : "paused"}, ${mins}:${secs} ${onBreak ? "break" : "focus"} — open controls`}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-semibold transition-colors hover:bg-[var(--color-accent-light-hover)]"
      style={{
        background: onBreak
          ? "color-mix(in srgb, var(--color-break) 14%, transparent)"
          : "var(--color-accent-light)",
        color: onBreak ? "var(--color-break)" : "var(--color-accent)",
      }}
    >
      {isRunning ? (
        <Pause className="w-3 h-3" fill="currentColor" />
      ) : (
        <Play className="w-3 h-3" fill="currentColor" />
      )}
      <span className="font-display tabular-nums">{mins}:{secs}</span>
      <span className="hidden sm:inline text-[10px] uppercase tracking-wider opacity-80">
        {onBreak ? "break" : "focus"}
      </span>
    </button>
  );
}
