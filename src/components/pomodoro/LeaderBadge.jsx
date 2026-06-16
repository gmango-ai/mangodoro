import { Crown, Lock } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Compact badge that tells the user who's driving the timer.
//
//   You control       → "👑 YOU'RE LEADING"  (accent-tinted pill)
//   Someone else      → "🔒 {name} controls" (muted text)
//   Not synced        → nothing rendered
//
// Sits under the play button cluster in the hero row.
export default function LeaderBadge() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession, syncParticipants } = useSyncSession();
  const { isSynced, isController } = usePomodoro();

  if (!isSynced || !syncSession) return null;

  if (isController) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <Crown className="w-3 h-3" fill="currentColor" />
        You're leading
      </span>
    );
  }

  const controller = (syncParticipants || []).find((p) => p.user_id === syncSession.controller_id);
  const name = controller?.display_name?.split(" ")[0] || "Someone";

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
      dark ? "text-slate-400" : "text-slate-500"
    }`}>
      <Lock className="w-3 h-3" />
      {name} controls
    </span>
  );
}
