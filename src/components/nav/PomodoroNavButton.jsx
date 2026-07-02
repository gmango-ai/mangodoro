import { Timer, Users } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Compact pomodoro quick-open for the mobile header's second row — replaces the
// edge pull-tab FAB on mobile. Opens the floating quick-controls popover
// (onOpen). Shows the remaining minutes + a synced icon while a timer runs, so
// it stays a glanceable indicator like the old FAB. Kept in its own component so
// the per-second pomodoro snapshot doesn't re-render the whole Nav.
function sessionSecondsLeft(session) {
  if (!session) return 0;
  if (session.is_running && session.ends_at) {
    return Math.max(0, Math.ceil((new Date(session.ends_at).getTime() - Date.now()) / 1000));
  }
  return Number.isFinite(session.remaining_seconds) ? session.remaining_seconds : 0;
}

export default function PomodoroNavButton({ dark, onOpen }) {
  const { secondsLeft, isRunning } = usePomodoro();
  const { activeTeamSessions } = useTeam();

  const teamSession = activeTeamSessions?.find((s) => s.is_running) || activeTeamSessions?.[0];
  const hasTeamSessions = (activeTeamSessions?.length || 0) > 0;
  const showTimer = isRunning || hasTeamSessions;
  const safeSeconds = isRunning
    ? (Number.isFinite(secondsLeft) ? secondsLeft : 0)
    : sessionSecondsLeft(teamSession);
  const minsLeft = Math.max(0, Math.ceil(safeSeconds / 60));

  return (
    <button
      type="button"
      onClick={() => onOpen?.()}
      title={showTimer ? `${minsLeft}m left — open pomodoro` : "Open pomodoro"}
      aria-label={showTimer ? `Pomodoro timer, ${minsLeft} minutes left — open` : "Open pomodoro timer"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-8 text-xs font-semibold transition-colors shrink-0 ${
        showTimer
          ? "bg-[var(--color-accent)] text-white"
          : dark ? "bg-white/5 text-slate-300 hover:text-white" : "bg-slate-100 text-slate-600 hover:text-slate-800"
      }`}
    >
      {showTimer && hasTeamSessions ? <Users className="w-4 h-4" /> : <Timer className="w-4 h-4" />}
      {showTimer && <span className="tabular-nums">{minsLeft}m</span>}
    </button>
  );
}
