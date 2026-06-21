import { useEffect, useState } from "react";
import { Copy, Link as LinkIcon, LogOut, Lock, Unlock } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { setSyncVisibility } from "../../lib/syncSession";
import { getShareableBaseUrl } from "../../lib/platform";
import SyncParticipantList from "../SyncParticipantList";
import ConfirmRow from "../ConfirmRow";
import StatusSetter from "./StatusSetter";

// The synced-session block: invite code + share, leave/end, visibility
// toggle (leader only), participant list, status, take-control flow,
// and a couple of hints. Returns null when there's no active session,
// so surfaces can render it unconditionally and it'll just vanish.
//
// `showParticipants` controls density: small surfaces (popover) skip
// the full list and just render the status row.
export default function SyncPanel({
  showParticipants = true,
  currentTaskHint = "",
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const userId = session?.user?.id;
  const {
    syncSession, syncParticipants, presenceMap,
    leaveSession, endSession, transferLeader, kickParticipant, takeControl,
  } = useSyncSession();
  const { isSynced, isLeader, isController, pendingAction } = usePomodoro();

  const [pendingTakeControl, setPendingTakeControl] = useState(false);
  const [takeControlError, setTakeControlError] = useState("");

  useEffect(() => {
    setPendingTakeControl(false);
    setTakeControlError("");
  }, [syncSession?.controller_id]);

  if (!isSynced || !syncSession) return null;

  const isParticipant = Array.isArray(syncParticipants)
    && syncParticipants.some((p) => p.user_id === userId);
  const controlsLocked = !!pendingAction || pendingTakeControl;

  async function confirmTakeControl() {
    if (!syncSession?.id) return;
    setTakeControlError("");
    const result = await takeControl(syncSession.id);
    if (result?.error) {
      setPendingTakeControl(false);
      setTakeControlError(result.error.message || "Could not take the lead");
      return;
    }
    setPendingTakeControl(false);
  }

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "bg-slate-50 border-slate-200"
    }`}>
      {/* Code + copy buttons + leave/end */}
      <div className="flex items-center justify-between gap-2 flex-wrap gap-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Code
          </span>
          <span className={`text-sm font-mono font-bold tracking-wider ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {syncSession.join_code}
          </span>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(syncSession.join_code)}
            title="Copy code"
            className={`p-1 rounded transition-colors ${
              dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
            }`}
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              const url = `${getShareableBaseUrl()}/pomodoro/join/${syncSession.join_code}`;
              navigator.clipboard?.writeText(url);
            }}
            title="Copy invite link"
            className={`p-1 rounded transition-colors ${
              dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
            }`}
          >
            <LinkIcon className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={leaveSession}
            title={isLeader ? "Leave — leadership transfers automatically" : "Leave session"}
            className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
              dark ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <LogOut className="w-3 h-3 inline mr-0.5" /> Leave
          </button>
          {isLeader && (
            <button
              type="button"
              onClick={endSession}
              title="End session for everyone"
              className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                dark ? "text-red-400 hover:bg-red-500/15" : "text-red-500 hover:bg-red-50"
              }`}
            >
              End
            </button>
          )}
        </div>
      </div>

      {/* Leader-only: visibility toggle */}
      {isLeader && (
        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={async () => {
              const next = syncSession.visibility === "team" ? "invite_only" : "team";
              await setSyncVisibility(syncSession.id, next);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition-colors ${
              syncSession.visibility === "team"
                ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
                : dark ? "bg-[var(--color-surface-raised)] text-slate-400" : "bg-slate-100 text-slate-500"
            }`}
            title={syncSession.visibility === "team"
              ? "Anyone on your team can see and join this session"
              : "Only people with the invite link can join"}
          >
            {syncSession.visibility === "team" ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {syncSession.visibility === "team" ? "Open to team" : "Closed (invite only)"}
          </button>
        </div>
      )}

      {/* Participants */}
      {showParticipants && (
        syncParticipants?.length > 0 ? (
          <SyncParticipantList
            participants={syncParticipants}
            leaderId={syncSession.leader_id}
            controllerId={syncSession.controller_id}
            presenceMap={presenceMap}
            currentUserId={userId}
            onTransferLeader={transferLeader}
            onKickParticipant={kickParticipant}
            onEditMyStatus={() => { /* StatusSetter handles its own editing now */ }}
          />
        ) : (
          <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Waiting for members to join…
          </p>
        )
      )}

      {/* My status + presence */}
      <StatusSetter currentTaskHint={currentTaskHint} />

      {/* Take control flow */}
      {isParticipant && !isController && !pendingTakeControl && (
        <button
          type="button"
          onClick={() => { setTakeControlError(""); setPendingTakeControl(true); }}
          disabled={controlsLocked && !pendingTakeControl}
          className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-md transition-colors bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
        >
          Take the lead
        </button>
      )}
      {pendingTakeControl && (
        <ConfirmRow
          dark={dark}
          prompt="Take over as session lead? You'll lead the room and control the timer for everyone."
          confirmLabel="Take the lead"
          confirmTone="primary"
          onConfirm={confirmTakeControl}
          onCancel={() => { setPendingTakeControl(false); setTakeControlError(""); }}
        />
      )}
      {takeControlError && (
        <p className={`text-[11px] px-1 ${dark ? "text-red-400" : "text-red-600"}`}>
          {takeControlError}
        </p>
      )}
      {isParticipant && !isController && !pendingTakeControl && (
        <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {(() => {
            const controller = syncParticipants?.find((p) => p.user_id === syncSession.controller_id);
            const name = controller?.display_name || "Someone else";
            return `${name} controls the timer`;
          })()}
        </p>
      )}
    </div>
  );
}
