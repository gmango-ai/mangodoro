import { useMemo } from "react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useOfficePresence } from "../../hooks/useOfficePresence";
import { availabilityDot, availabilityLabel } from "../../lib/presence";
import UserAvatar from "../UserAvatar";

// Whole-team status roster read from the single source (user_presence, via
// useOfficePresence) merged with realtime liveness. Grouped by WHERE people are:
// when you're IN a room, that room is pinned first as "In this room"; then the
// other rooms, then "In the hallway" (online, no room), then "Offline". So the
// one list answers "who's here with me, where is everyone else, who's offline".
// Presentational body only (no card/section chrome) so it can live in the
// office sidebar widget AND the hallway.
export default function TeamStatusRoster({ dark }) {
  const { session } = useApp();
  const { teamMembers, rooms } = useTeam();
  const { syncSession } = useSyncSession();
  const userId = session?.user?.id;
  const currentRoomId = syncSession?.room_id || null;

  // Identity for everyone (so offline teammates still show a name/avatar and the
  // whole team is listed, not just who's been seen recently).
  const identity = useMemo(() => {
    const m = {};
    (teamMembers || []).forEach((tm) => {
      if (tm.user_id) m[tm.user_id] = { name: tm.name || tm.display_name || "", avatar: tm.avatar || tm.avatar_url || "" };
    });
    return m;
  }, [teamMembers]);

  // Scope strictly to the CURRENT org's members. useOfficePresence reads every
  // user_presence row the RLS allows — which spans ALL teams you share with
  // someone — so a multi-org user would otherwise see other orgs bleed in. The
  // identity map IS the current team's roster, so it's the authoritative filter.
  const people = useOfficePresence(identity).filter((p) => identity[p.userId]);

  const roomName = useMemo(() => {
    const map = {};
    (rooms || []).forEach((r) => { map[r.id] = r.name; });
    return map;
  }, [rooms]);

  const groups = useMemo(() => {
    const roomsG = new Map(); // roomId -> people[]
    const around = [];
    const offline = [];
    for (const p of people) {
      if (!p.online) { offline.push(p); continue; }
      if (p.locationKind === "room" && p.locationRoomId) {
        if (!roomsG.has(p.locationRoomId)) roomsG.set(p.locationRoomId, []);
        roomsG.get(p.locationRoomId).push(p);
      } else {
        around.push(p);
      }
    }
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    const out = [];
    const roomEntries = [...roomsG.entries()];
    // Pin the room you're in first, labeled "In this room".
    const cur = currentRoomId ? roomEntries.find(([rid]) => rid === currentRoomId) : null;
    if (cur) out.push({ key: `room:${cur[0]}`, label: "In this room", people: cur[1].sort(byName), highlight: true });
    roomEntries
      .filter(([rid]) => rid !== currentRoomId)
      .sort((a, b) => (roomName[a[0]] || "").localeCompare(roomName[b[0]] || ""))
      .forEach(([rid, list]) => out.push({ key: `room:${rid}`, label: roomName[rid] || "A room", people: list.sort(byName) }));
    if (around.length) out.push({ key: "around", label: "In the hallway", people: around.sort(byName) });
    if (offline.length) out.push({ key: "offline", label: "Offline", people: offline.sort(byName), muted: true });
    return out;
  }, [people, roomName, currentRoomId]);

  if (people.length === 0) {
    return <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>No teammates yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.key}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${
            g.highlight ? "text-[var(--color-accent)]" : dark ? "text-slate-500" : "text-slate-400"
          }`}>
            {g.label} <span className="tabular-nums opacity-70">{g.people.length}</span>
          </p>
          <ul className="space-y-1">
            {g.people.map((p) => (
              <li key={p.userId} className="flex items-center gap-2">
                <span className="relative shrink-0">
                  <UserAvatar url={p.avatar} name={p.name || "Member"} size={22} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ${availabilityDot(p.availability)} ${
                      dark ? "ring-[var(--color-surface)]" : "ring-white"
                    }`}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[11px] font-medium truncate ${
                    g.muted ? (dark ? "text-slate-500" : "text-slate-400") : dark ? "text-slate-200" : "text-slate-700"
                  }`}>
                    {p.name || "Member"}{p.userId === userId ? " (you)" : ""}
                  </span>
                  <span className={`block text-[10px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {p.online && p.activity?.label ? p.activity.label : availabilityLabel(p.availability)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
