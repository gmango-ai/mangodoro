import { Link as LinkIcon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { getShareableBaseUrl } from "../../lib/platform";

// "Sync Code: AZ56V3" with a Share Link button on the right. Renders
// in its own row to match the redesign mockup — the code itself is
// the click target for "copy code", the Share Link button copies the
// full invite URL.
export default function SyncCodeRow() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession } = useSyncSession();
  const { isSynced } = usePomodoro();

  if (!isSynced || !syncSession) return null;

  const shareUrl = `${getShareableBaseUrl()}/pomodoro/join/${syncSession.join_code}`;

  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-y ${
      dark ? "border-[var(--color-border)]" : "border-slate-200"
    }`}>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(syncSession.join_code)}
        title="Copy code"
        className="inline-flex items-center gap-2 text-left"
      >
        <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Sync Code:
        </span>
        <span className="text-sm font-mono font-bold tracking-wider text-[var(--color-accent)]">
          {syncSession.join_code}
        </span>
      </button>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(shareUrl)}
        title="Copy invite link"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
          dark ? "text-slate-400 hover:text-[var(--color-accent)]" : "text-slate-500 hover:text-[var(--color-accent)]"
        }`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
        Share Link
      </button>
    </div>
  );
}
