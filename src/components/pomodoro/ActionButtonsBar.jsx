import { Crown, LogOut, StopCircle } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Context-aware bottom action bar.
//
//   Leader     → "End Session for All" outlined red, full-width
//                (+ "Take control" when someone else holds the timer)
//   Non-leader → "Take the lead" + "Leave" as a 50/50 pair
//   Not synced → nothing
//
// Replaces the prior top-of-card "× Leave  End Session" row; bottom-
// placement matches the mockup and makes destructive actions feel
// like the "end of the flow" rather than competing with the team
// header.
export default function ActionButtonsBar() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession, leaveSession, endSession, takeControl } = useSyncSession();
  const { isSynced, isLeader, isController } = usePomodoro();

  if (!isSynced || !syncSession) return null;

  if (isLeader) {
    // The leader is the session admin, but timer control can be held by
    // anyone who took it. When the leader isn't the current controller,
    // offer a way to take it back — otherwise the host is locked out of
    // their own timer with only "End Session" as recourse.
    return (
      <div className="flex items-center gap-2">
        {!isController && (
          <button
            type="button"
            onClick={() => takeControl(syncSession.id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-full text-sm font-semibold transition-colors ${
              dark
                ? "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
                : "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
            }`}
          >
            <Crown className="w-4 h-4" />
            Take control
          </button>
        )}
        <button
          type="button"
          onClick={endSession}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-full text-sm font-semibold transition-colors ${
            dark
              ? "border border-red-500/40 text-red-400 hover:bg-red-500/10"
              : "border border-red-200 text-red-600 hover:bg-red-50"
          }`}
        >
          <StopCircle className="w-4 h-4" />
          End Session for All
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!isController && (
        <button
          type="button"
          onClick={() => takeControl(syncSession.id)}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-full text-sm font-semibold transition-colors ${
            dark
              ? "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
              : "border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
          }`}
        >
          <Crown className="w-4 h-4" />
          Take the lead
        </button>
      )}
      <button
        type="button"
        onClick={leaveSession}
        className={`${isController ? "flex-1" : "flex-1"} inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-full text-sm font-semibold transition-colors ${
          dark
            ? "border border-red-500/40 text-red-400 hover:bg-red-500/10"
            : "border border-red-200 text-red-600 hover:bg-red-50"
        }`}
      >
        <LogOut className="w-4 h-4" />
        Leave
      </button>
    </div>
  );
}
