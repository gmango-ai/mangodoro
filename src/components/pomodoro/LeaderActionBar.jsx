import { X } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Top-of-card Leave / End Session row. Visible only when the user is
// in a sync session. "End Session" is leader-only and tinted red so
// it stands apart from the "leave just me" path.
export default function LeaderActionBar() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession, leaveSession, endSession } = useSyncSession();
  const { isLeader, isSynced } = usePomodoro();

  if (!isSynced || !syncSession) return null;

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={leaveSession}
        title={isLeader ? "Leave — leadership transfers automatically" : "Leave session"}
        className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors ${
          dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <X className="w-3.5 h-3.5" />
        Leave
      </button>
      {isLeader && (
        <button
          type="button"
          onClick={endSession}
          title="End session for everyone"
          className={`text-xs font-semibold transition-colors ${
            dark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-600"
          }`}
        >
          End Session
        </button>
      )}
    </div>
  );
}
