import { useMemo } from "react";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { useProfileCard } from "../../context/ProfileContext";
import { useClockedIn } from "../../hooks/useClockedIn";
import { useTeamPresence } from "../../hooks/useTeamPresence";
import UserAvatar from "../UserAvatar";
import { presenceRing, presenceLabel } from "../../lib/presence";
import { Crown } from "lucide-react";

// Presence states that count as "around in the hallway" when not clocked in —
// the engaged/at-desk ones. Idle (away) and explicitly-away (lunch/commuting)
// are online but not "here", so we leave them out of the hallway.
const HALLWAY_PRESENT = new Set(["active", "available", "heads_down", "in_meeting"]);

// Ambient "who's in the office" strip for the hallway header.
//
// Two groups:
//   • In rooms      — everyone across every active session, deduped. Click an
//                     avatar to walk to the room they're in.
//   • In the hallway — clocked in but not in any room ("working / in-office,
//                     even when remote"). Click opens their profile card.
// So the hallway reads as inhabited the moment you arrive, and remote folks
// who are heads-down at their desk still show up as present.
export default function OfficePresenceBar({ sessionByRoomId, rooms, onEnterRoom, dark }) {
  const { teamsByUserId, teamMembers = [] } = useTeam();
  const { session, settings } = useApp();
  const { openProfile } = useProfileCard();
  const clocked = useClockedIn();
  const online = useTeamPresence();
  const myId = session?.user?.id;

  // People in rooms (first session a person appears in wins).
  const people = useMemo(() => {
    const roomById = new Map((rooms || []).map((r) => [r.id, r]));
    const seen = new Map();
    for (const [roomId, session2] of sessionByRoomId?.entries?.() || []) {
      for (const o of session2.occupants || []) {
        if (!o.user_id || seen.has(o.user_id)) continue;
        seen.set(o.user_id, {
          ...o,
          roomId,
          roomName: roomById.get(roomId)?.name || "a room",
          isLeader: o.user_id === session2.leader_id,
        });
      }
    }
    return [...seen.values()];
  }, [sessionByRoomId, rooms]);

  const inRoomIds = useMemo(() => new Set(people.map((p) => p.user_id)), [people]);
  const memberById = useMemo(() => new Map((teamMembers || []).map((m) => [m.user_id, m])), [teamMembers]);

  // In the hallway = NOT in a room, and either clocked in OR detected online
  // (Realtime Presence) in a "present" state. Clocked-in people show their work
  // status; online-only people show as "active" via their presence ring.
  const hallway = useMemo(() => {
    const map = new Map();
    // Clocked in (existing) — keep self too.
    for (const r of clocked || []) {
      if (!r.clocked_in_at || inRoomIds.has(r.user_id)) continue;
      if (!(memberById.has(r.user_id) || r.user_id === myId)) continue;
      const m = memberById.get(r.user_id);
      map.set(r.user_id, {
        user_id: r.user_id,
        name: m?.name || (r.user_id === myId ? settings?.name : "") || "Member",
        avatar_url: m?.avatar_url || (r.user_id === myId ? settings?.avatarUrl : "") || "",
        clocked: true,
        on_break: r.on_break,
        task: r.task,
        presence_state: null,
      });
    }
    // Online but not clocked in — teammates only (not self), present states.
    for (const p of online || []) {
      if (p.user_id === myId || inRoomIds.has(p.user_id) || map.has(p.user_id)) continue;
      if (!memberById.has(p.user_id) || !HALLWAY_PRESENT.has(p.presence_state)) continue;
      const m = memberById.get(p.user_id);
      map.set(p.user_id, {
        user_id: p.user_id,
        name: m?.name || p.name || "Member",
        avatar_url: m?.avatar_url || p.avatar_url || "",
        clocked: false,
        on_break: false,
        task: "",
        presence_state: p.presence_state,
      });
    }
    return [...map.values()];
  }, [clocked, online, inRoomIds, memberById, myId, settings]);

  if (people.length === 0 && hallway.length === 0) return null;

  const MAX = 12;
  const label = `text-[10px] font-bold uppercase tracking-wider shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {people.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={label}>In rooms</span>
          <div className="flex items-center">
            {people.slice(0, MAX).map((p) => {
              const teams = teamsByUserId?.get(p.user_id) || [];
              const teamNames = teams.map((t) => t.name).join(" · ");
              const title = `${p.name} — ${presenceLabel(p.presence_state)} · in ${p.roomName}${teamNames ? ` · ${teamNames}` : ""}`;
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
                  {p.isLeader && <Crown className="absolute -top-1.5 -right-1.5 w-3 h-3 text-amber-400 drop-shadow" fill="currentColor" />}
                </button>
              );
            })}
            {people.length > MAX && (
              <span className={`-ml-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ring-2 ring-transparent ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-700"}`} title={`${people.length - MAX} more`}>
                +{people.length - MAX}
              </span>
            )}
          </div>
        </div>
      )}

      {hallway.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={label}>In the hallway</span>
          <div className="flex items-center">
            {hallway.slice(0, MAX).map((p) => {
              const ring = p.clocked ? (p.on_break ? "ring-orange-500" : "ring-emerald-500") : presenceRing(p.presence_state);
              const status = p.clocked ? (p.on_break ? "On lunch" : "Working") : presenceLabel(p.presence_state);
              const title = `${p.name} — ${status}${p.task?.trim() ? ` · ${p.task}` : ""} · in the hallway`;
              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={(e) => openProfile?.(p.user_id, e.currentTarget.getBoundingClientRect())}
                  title={title}
                  aria-label={title}
                  className={`relative shrink-0 rounded-full ring-2 ${ring} -ml-2 first:ml-0 transition-transform hover:-translate-y-0.5 hover:z-10`}
                >
                  <UserAvatar url={p.avatar_url} name={p.name} size={28} />
                </button>
              );
            })}
            {hallway.length > MAX && (
              <span className={`-ml-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ring-2 ring-transparent ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-700"}`} title={`${hallway.length - MAX} more`}>
                +{hallway.length - MAX}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
