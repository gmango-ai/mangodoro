import { useMemo } from "react";
import { useTeam } from "../../context/TeamContext";
import UserAvatar from "../UserAvatar";
import { presenceRing, presenceLabel } from "../../lib/presence";
import { Crown } from "lucide-react";

// Ambient "who's in the office" strip for the hallway header.
//
// The floor plan only shows presence room-by-room, so an office where
// people are scattered one-per-room still reads as empty at a glance.
// This collapses everyone across every active session into a single
// deduped row of avatars — the hallway looks inhabited the moment you
// arrive. Clicking an avatar walks you straight to the room they're in,
// which doubles as lightweight wayfinding ("go to where people are").
export default function OfficePresenceBar({ sessionByRoomId, rooms, onEnterRoom, dark }) {
  const { teamsByUserId } = useTeam();

  // Flatten sessions → one entry per distinct person. First session a
  // person appears in wins (a user shouldn't be in two at once, but if
  // a stale row lingers we don't want them rendered twice).
  const people = useMemo(() => {
    const roomById = new Map((rooms || []).map((r) => [r.id, r]));
    const seen = new Map();
    for (const [roomId, session] of sessionByRoomId?.entries?.() || []) {
      for (const o of session.occupants || []) {
        if (!o.user_id || seen.has(o.user_id)) continue;
        seen.set(o.user_id, {
          ...o,
          roomId,
          roomName: roomById.get(roomId)?.name || "a room",
          isLeader: o.user_id === session.leader_id,
        });
      }
    }
    return [...seen.values()];
  }, [sessionByRoomId, rooms]);

  if (people.length === 0) return null;

  const MAX = 12;
  const visible = people.slice(0, MAX);
  const overflow = people.length - visible.length;

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${
        dark ? "text-slate-500" : "text-slate-400"
      }`}>
        In the office
      </span>
      <div className="flex items-center">
        {visible.map((p) => {
          const teams = teamsByUserId?.get(p.user_id) || [];
          const teamNames = teams.map((t) => t.name).join(" · ");
          const title = `${p.name} — ${presenceLabel(p.presence_state)} · in ${p.roomName}${
            teamNames ? ` · ${teamNames}` : ""
          }`;
          return (
            <button
              key={p.user_id}
              type="button"
              onClick={() => onEnterRoom?.(p.roomId)}
              title={title}
              aria-label={title}
              className={`relative shrink-0 rounded-full ring-2 ${presenceRing(p.presence_state)} -ml-2 first:ml-0 transition-transform hover:-translate-y-0.5 hover:z-10`}
            >
              <UserAvatar url={p.avatar_url} name={p.name} size={28} />
              {p.isLeader && (
                <Crown
                  className="absolute -top-1.5 -right-1.5 w-3 h-3 text-amber-400 drop-shadow"
                  fill="currentColor"
                />
              )}
            </button>
          );
        })}
        {overflow > 0 && (
          <span
            className={`-ml-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ring-2 ring-transparent ${
              dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-700"
            }`}
            title={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
