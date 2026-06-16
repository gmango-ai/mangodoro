import { Copy, Link as LinkIcon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { getShareableBaseUrl } from "../../lib/platform";

// Bordered pill container holding the SYNC CODE (with copy icon) on
// the left and a Share button on the right. The Share button is a
// solid accent pill when the user is the controller (you're driving
// the session so sharing is your primary action), and an outlined
// pill otherwise (sharing still works but reads as secondary).
export default function SyncCodeRow() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession } = useSyncSession();
  const { isSynced, isController } = usePomodoro();

  if (!isSynced || !syncSession) return null;

  const shareUrl = `${getShareableBaseUrl()}/pomodoro/join/${syncSession.join_code}`;

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "border-slate-200 bg-slate-50"
    }`}>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Sync Code
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(syncSession.join_code)}
            title="Copy code"
            className="inline-flex items-center gap-2 text-lg font-mono font-bold tracking-wider text-[var(--color-accent)]"
          >
            {syncSession.join_code}
            <Copy className={`w-3.5 h-3.5 opacity-60 ${dark ? "text-slate-400" : "text-slate-500"}`} />
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(shareUrl)}
        title="Copy invite link"
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors shrink-0 ${
          isController
            ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-sm"
            : dark
              ? "border border-[var(--color-border)] bg-[var(--color-surface)] text-slate-200 hover:border-[var(--color-accent)]"
              : "border border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]"
        }`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
        Share
      </button>
    </div>
  );
}
