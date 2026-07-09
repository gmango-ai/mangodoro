import { Crown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { sortParticipants } from "../../lib/participantSort";
import { useParticipantSort } from "../../hooks/useParticipantSort";
import { availabilityDot, availabilityLabel, shownAvailability } from "../../lib/presence";
import { usePresenceById } from "../../hooks/usePresenceById";
import ParticipantSortPicker from "./ParticipantSortPicker";

function Avatar({ participant, size = 40, dark }) {
  const initial = (participant.display_name || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("") || "?";
  const url = participant.avatar_url;
  return (
    <div
      className="relative rounded-full overflow-hidden shrink-0 inline-flex items-center justify-center text-white font-bold"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 2.8)) }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full ${
            dark ? "bg-slate-700 text-slate-100" : "bg-slate-300 text-slate-700"
          }`}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

function ParticipantCard({ participant, isLeader, isSelf, dark }) {
  const presenceById = usePresenceById();
  const avail = shownAvailability(participant.user_id, participant.presence_state, presenceById);
  const dotCls = availabilityDot(avail);
  const statusText = participant.status?.trim() || availabilityLabel(avail);

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="relative">
        <Avatar participant={participant} dark={dark} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
            dark ? "border-[var(--color-surface)]" : "border-white"
          } ${dotCls}`}
          title={availabilityLabel(avail)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {isSelf ? `${participant.display_name || "You"} (You)` : (participant.display_name || "Member")}
          </span>
          {isLeader && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
              <Crown className="w-2.5 h-2.5" fill="currentColor" />
              Leader
            </span>
          )}
        </div>
        <p className={`text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {statusText}
        </p>
      </div>
    </div>
  );
}

// Vertical card list of session participants. Mockup-matched: avatar
// with a colored presence dot, name with optional LEADER crown, status
// text below. Capped at `max` rows with an "+N more focusing" overflow
// when there are more participants than fit in the surface.
export default function ParticipantCards({ max = 5 }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const { syncSession, syncParticipants } = useSyncSession();
  const { isSynced } = usePomodoro();
  const [sortMode] = useParticipantSort();

  if (!isSynced || !syncSession) return null;

  const participants = syncParticipants || [];
  if (!participants.length) return null;

  const userId = session?.user?.id;

  // "You" first, the leader second, then everyone else by the chosen sort —
  // stable across refetches (see lib/participantSort).
  const sorted = sortParticipants(participants, {
    mode: sortMode,
    userId,
    leaderId: syncSession.leader_id,
  });

  const visible = sorted.slice(0, max);
  const overflowCount = sorted.length - visible.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h3 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
          In Session
        </h3>
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          {participants.length}
        </span>
        {participants.length > 1 && <ParticipantSortPicker className="ml-auto" />}
      </div>
      <ul className={`divide-y ${dark ? "divide-[var(--color-border)]" : "divide-slate-100"}`}>
        {visible.map((p) => (
          <li key={p.user_id}>
            <ParticipantCard
              participant={p}
              isLeader={p.user_id === syncSession.leader_id}
              isSelf={p.user_id === userId}
              dark={dark}
            />
          </li>
        ))}
        {overflowCount > 0 && (
          <li className="py-2">
            <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
              +{overflowCount} more focusing
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
