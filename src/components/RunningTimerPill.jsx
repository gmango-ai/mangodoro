import { Play, Pause, Timer, Users } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";

// Always-visible Nav pill that surfaces the current pomodoro state.
// Replaces the floating bottom-right FAB so the timer is a Nav-
// citizen instead of overlay chrome.
//
// States:
//   running       → "FOCUS · 24:13" — accent background, pulsing dot
//   running synced→ "FOCUS · 24:13" + users icon
//   paused/idle   → "▶ Start" — neutral background
//
// Click fires `onOpen`, which the App routes to the floating
// PomodoroTimer modal (same as the previous FAB behavior). On
// /pomodoro itself the pill still renders, but it acts as a quick
// "pause/resume" visual rather than another way into the modal.
function modeLabel(m) {
  if (m === "shortBreak") return "Short";
  if (m === "longBreak") return "Long";
  return "Focus";
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function RunningTimerPill({ onOpen }) {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const { syncSession } = useSyncSession();

  const onPomodoroPage = location.pathname.startsWith("/pomodoro");
  const synced = !!syncSession;
  const showTimer = isRunning;
  const safeSeconds = Number.isFinite(secondsLeft) ? secondsLeft : 0;

  const activeCls = dark
    ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
    : "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]";
  const idleCls = dark
    ? "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-200 hover:border-[var(--color-accent)]"
    : "border border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]";

  return (
    <button
      type="button"
      onClick={() => onOpen?.()}
      title={showTimer ? `${modeLabel(mode)} timer — ${formatTime(safeSeconds)} left` : "Open pomodoro"}
      aria-label={showTimer ? `${modeLabel(mode)} timer, ${formatTime(safeSeconds)} remaining` : "Open pomodoro"}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors shrink-0 ${
        showTimer ? activeCls : idleCls
      } ${onPomodoroPage ? "opacity-90" : ""}`}
    >
      {showTimer ? (
        <>
          {synced
            ? <Users className="w-3.5 h-3.5" />
            : (isRunning
              ? <Pause className="w-3.5 h-3.5" fill="currentColor" />
              : <Timer className="w-3.5 h-3.5" />)}
          <span className="uppercase tracking-wider text-[10px] opacity-90">
            {modeLabel(mode)}
          </span>
          <span className="text-sm font-display font-bold tabular-nums">
            {formatTime(safeSeconds)}
          </span>
        </>
      ) : (
        // Idle: icon-only so it stays compact next to the clock + working-now
        // pills; the running state still shows the full "FOCUS · 24:13".
        <Play className="w-3.5 h-3.5" fill="currentColor" />
      )}
    </button>
  );
}
