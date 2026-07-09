import { Users, Crown } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { sortParticipants } from "../../lib/participantSort";
import { useParticipantSort } from "../../hooks/useParticipantSort";
import ParticipantSortPicker from "../pomodoro/ParticipantSortPicker";
import UserAvatar from "../UserAvatar";
import WidgetSection from "./WidgetSection";
import { presenceDot, presenceLabel } from "../../lib/presence";

// Lists everyone currently in the user's active sync session — i.e.
// the people in this room with them. Reads from SyncSessionContext's
// syncParticipants array so it stays live via the existing realtime
// channel; presenceMap supplies presence dots for users currently
// tracked on the channel.
//
// When the user isn't in a session, the widget shows a muted hint
// rather than disappearing — the slot's presence in the sidebar
// reads as "there's a thing here, you just don't have anyone yet."
export default function RoomMembersWidget({ dark }) {
  const { session } = useApp();
  const { syncSession, syncParticipants, presenceMap } = useSyncSession();
  const [sortMode] = useParticipantSort();

  const userId = session?.user?.id;
  const inSession = !!syncSession;
  const participants = (syncParticipants || []).filter((p) => !p.left_at);

  // Stable display order (leader/you pinned, rest by the chosen sort).
  const ordered = sortParticipants(participants, {
    mode: sortMode,
    userId,
    leaderId: syncSession?.leader_id,
  });

  const count = participants.length;
  const titleAction = inSession && count > 0 ? (
    <span className="flex items-center gap-1.5">
      {count > 1 && <ParticipantSortPicker iconOnly />}
      <span className="text-[10px] font-bold tabular-nums">{count}</span>
    </span>
  ) : null;

  return (
    <WidgetSection
      id="room-members"
      icon={Users}
      title="In room"
      dark={dark}
      action={titleAction}
    >
      {!inSession ? (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Enter a room to see who's here with you.
        </p>
      ) : count === 0 ? (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Nobody else here yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ordered
            .map((p) => {
              const isLeader = p.user_id === syncSession.leader_id;
              const isMe = p.user_id === userId;
              const online = !!presenceMap?.[p.user_id];
              const presence = p.presence_state || "active";
              return (
                <li
                  key={p.user_id}
                  className="flex items-center gap-2"
                  title={`${p.display_name || "Member"} · ${presenceLabel(presence)}${
                    online ? " · here now" : " · idle"
                  }`}
                >
                  <span className="relative shrink-0">
                    <UserAvatar
                      url={p.avatar_url || ""}
                      name={p.display_name || "Member"}
                      size={24}
                    />
                    {/* Tiny presence dot in the corner — reuses the
                        same color map as the rest of the office UI. */}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ${
                        presenceDot(presence)
                      } ${dark ? "ring-[var(--color-surface)]" : "ring-white"}`}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] font-semibold truncate ${
                      dark ? "text-slate-100" : "text-slate-800"
                    }`}>
                      {p.display_name || "Member"}
                      {isMe && (
                        <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider ${
                          dark ? "text-slate-500" : "text-slate-400"
                        }`}>
                          you
                        </span>
                      )}
                    </span>
                    {p.status?.trim() && (
                      <span className={`block text-[10px] truncate ${
                        dark ? "text-slate-500" : "text-slate-400"
                      }`}>
                        {p.status}
                      </span>
                    )}
                  </span>
                  {isLeader && (
                    <Crown
                      className="w-3 h-3 text-[var(--color-accent)] shrink-0"
                      fill="currentColor"
                      aria-label="Leader"
                    />
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </WidgetSection>
  );
}
