import { useMemo, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { useClockedIn } from "../../hooks/useClockedIn";
import {
  Users, Timer, Pencil, Search, LayoutGrid, List as ListIcon,
  Hash, Briefcase, MessageSquare, Lock, LockOpen, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import OfficeLayoutEditor from "../OfficeLayoutEditor";
import OfficePresenceBar from "./OfficePresenceBar";
import TeamStatusRoster from "./TeamStatusRoster";
import UserAvatar from "../UserAvatar";
import { availabilityRing, shownAvailability } from "../../lib/presence";
import { usePresenceById } from "../../hooks/usePresenceById";

const KIND_ICON = {
  general: Hash,
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};
const KIND_LABEL = {
  general: "General",
  department: "Departments",
  meeting: "Meetings",
  private: "Private",
};
const KIND_ORDER = ["general", "department", "meeting", "private"];

const VIEW_MODE_KEY = "ql_hallway_view_mode";
function loadViewMode() {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "list" || v === "floor") return v;
  } catch { /* */ }
  return "floor";
}
function saveViewMode(v) {
  try { localStorage.setItem(VIEW_MODE_KEY, v); } catch { /* */ }
}

// "Hallway" — the bare /office route. Shows the floor-plan of all
// rooms at a glance, click a tile to enter. Different from the room
// view in that there's no current-room context: you're standing in
// the office, not inside any particular room.
//
// Reuses OfficeLayoutEditor in readOnly mode (same component that
// admins use to edit the layout). Click handler navigates into the
// room.
//
// Locked rooms (gated to org_teams the viewer isn't in) render inline
// alongside their team-mates' rooms with a lock badge — same floor
// plan, no surprise gaps when the team layout decisions get reshuffled.
export default function HallwayView({
  activeTeam, rooms, sessionByRoomId, onlineCount, canEdit,
  busy, onEnterRoom, onEditOffice, lockedRooms,
}) {
  const { theme } = useTheme();
  const { orgTeams, teamMembers = [] } = useTeam();
  const { session } = useApp();
  const clocked = useClockedIn();
  const dark = theme === "dark";
  const sessionCount = [...(sessionByRoomId?.values() || [])].length;

  // "In the office" = people in rooms PLUS clocked-in teammates standing in
  // the hallway (working/in-office even when remote, no overlap since hallway
  // excludes anyone in a room). Mirrors OfficePresenceBar.
  const inOfficeCount = useMemo(() => {
    const inRoom = new Set();
    for (const [, sess] of sessionByRoomId?.entries?.() || []) {
      for (const o of sess.occupants || []) if (o.user_id) inRoom.add(o.user_id);
    }
    const myId = session?.user?.id;
    const memberIds = new Set((teamMembers || []).map((m) => m.user_id));
    const hallway = (clocked || []).filter(
      (r) => r.clocked_in_at && !inRoom.has(r.user_id) && (memberIds.has(r.user_id) || r.user_id === myId)
    ).length;
    return inRoom.size + hallway;
  }, [sessionByRoomId, clocked, teamMembers, session]);

  const [viewMode, setViewModeRaw] = useState(loadViewMode);
  const setViewMode = (v) => { setViewModeRaw(v); saveViewMode(v); };
  const [query, setQuery] = useState("");

  // Merge visible + locked into one floor plan, plus a Set the layout
  // editor uses to flip RoomTile into the disabled+badged state.
  const mergedRooms = useMemo(
    () => [...(rooms || []), ...(lockedRooms || [])],
    [rooms, lockedRooms],
  );
  const lockedRoomIds = useMemo(
    () => new Set((lockedRooms || []).map((r) => r.id)),
    [lockedRooms],
  );

  // Search-filtered view for list mode. Floor plan stays unfiltered so
  // the spatial layout doesn't shuffle around — the grid is a "place,"
  // not a result set. Names + kind labels are searched.
  const filteredForList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mergedRooms;
    return mergedRooms.filter((r) => {
      const name = (r.name || "").toLowerCase();
      const kind = (r.kind || "").toLowerCase();
      return name.includes(q) || kind.includes(q);
    });
  }, [mergedRooms, query]);

  // Group list-view rooms by kind, in the canonical order (general,
  // department, meeting, private). Empty groups are dropped.
  const groupedByKind = useMemo(() => {
    const groups = new Map();
    for (const k of KIND_ORDER) groups.set(k, []);
    for (const r of filteredForList) {
      const k = KIND_ORDER.includes(r.kind) ? r.kind : "general";
      groups.get(k).push(r);
    }
    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [filteredForList]);
  // Names of the org_teams that gate a given locked room — surfaced
  // in the tooltip so the viewer knows who to ask.
  const lockedReasonFor = useMemo(() => {
    const teamById = new Map((orgTeams || []).map((t) => [t.id, t]));
    return (room) => {
      const names = (room.room_teams || [])
        .map((rt) => teamById.get(rt.org_team_id)?.name)
        .filter(Boolean);
      if (names.length === 0) return "Members of the gating team only";
      return `Members of ${names.join(", ")} only`;
    };
  }, [orgTeams]);

  return (
    <div data-tour="hallway">
      <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {activeTeam?.name || "Office"}
            </p>
            <h1 className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Hallway
            </h1>
            <p className={`text-xs mt-1 inline-flex items-center gap-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span className={`font-semibold ${inOfficeCount > 0 ? "text-[var(--color-accent)]" : ""}`}>
                  {inOfficeCount}
                </span>
                {inOfficeCount === 1 ? " person" : " people"} in the office
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer className="w-3 h-3" />
                <span className="font-semibold">{sessionCount}</span>
                {sessionCount === 1 ? " active session" : " active sessions"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* View toggle — floor plan (default) or grouped list (better
                when room count is high). Persisted per-user. */}
            <div className={`inline-flex p-0.5 rounded-full ${
              dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
            }`}>
              {[
                { key: "floor", Icon: LayoutGrid, label: "Floor" },
                { key: "list",  Icon: ListIcon,   label: "List"  },
              ].map(({ key, Icon, label }) => {
                const active = viewMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setViewMode(key)}
                    title={`${label} view`}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors ${
                      active
                        ? "bg-[var(--color-accent)] text-white shadow-sm"
                        : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                );
              })}
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEditOffice} className="h-8 text-xs">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit office
              </Button>
            )}
          </div>
        </div>

        {/* Ambient presence — everyone across all rooms in one row, so
            the hallway reads as inhabited even when people are scattered
            one-per-room. Click an avatar to walk to their room. */}
        <OfficePresenceBar
          sessionByRoomId={sessionByRoomId}
          rooms={mergedRooms}
          onEnterRoom={onEnterRoom}
          dark={dark}
        />

        {/* Search — visible in list mode where it makes sense. Floor
            mode keeps the spatial layout stable rather than filtering
            tiles in/out of position. */}
        {viewMode === "list" && (
          <div className="mt-3 relative max-w-md">
            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
              dark ? "text-slate-500" : "text-slate-400"
            }`} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rooms…"
              className={`w-full pl-8 pr-8 py-1.5 rounded-md border text-xs ${
                dark
                  ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-200 placeholder:text-slate-500"
                  : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
              }`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md ${
                  dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

      <div className="mt-5">
        {mergedRooms.length === 0 ? (
          <div className={`text-center py-12 rounded-2xl border border-dashed ${
            dark ? "border-[var(--color-border)] text-slate-400" : "border-slate-300 text-slate-500"
          }`}>
            <p className="text-sm">No rooms yet.</p>
            {canEdit && (
              <Button onClick={onEditOffice} className="mt-3" size="sm">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Set up the office
              </Button>
            )}
          </div>
        ) : viewMode === "floor" ? (
          <OfficeLayoutEditor
            rooms={mergedRooms}
            readOnly
            vibe={activeTeam?.office_vibe || "quiet"}
            busy={busy}
            onOpenRoom={(room) => onEnterRoom?.(room.id)}
            onJoinRoom={(room) => onEnterRoom?.(room.id)}
            sessionByRoomId={sessionByRoomId}
            lockedRoomIds={lockedRoomIds}
            lockedReasonFor={lockedReasonFor}
          />
        ) : (
          <ListView
            grouped={groupedByKind}
            sessionByRoomId={sessionByRoomId}
            lockedRoomIds={lockedRoomIds}
            lockedReasonFor={lockedReasonFor}
            onEnterRoom={onEnterRoom}
            dark={dark}
          />
        )}
      </div>

      {/* Whole-team status list — who's in which room, who's around, who's
          offline. Reads the same single source as the in-room roster. */}
      <div className={`mt-6 rounded-2xl border p-4 ${
        dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-center gap-1.5 mb-3">
          <Users className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <h2 className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-300" : "text-slate-600"}`}>
            Team status
          </h2>
        </div>
        <TeamStatusRoster dark={dark} />
      </div>
    </div>
  );
}

// Grouped list of rooms — denser than the floor plan once a team has
// more than ~12 rooms or rooms with similar layouts. Each group is a
// kind (general / department / meeting / private). Inside a group,
// rooms render as compact cards with name + occupant dots + status.
//
// Locked rooms render with the same dim+lock affordance as in the
// floor view so the gating cue stays consistent across views.
function ListView({ grouped, sessionByRoomId, lockedRoomIds, lockedReasonFor, onEnterRoom, dark }) {
  const presenceById = usePresenceById();
  if (!grouped.length) {
    return (
      <p className={`text-sm text-center py-10 ${dark ? "text-slate-500" : "text-slate-400"}`}>
        No rooms match.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {grouped.map(([kind, list]) => {
        const Icon = KIND_ICON[kind] || Hash;
        return (
          <section key={kind}>
            <header className={`flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              <Icon className="w-3 h-3" />
              {KIND_LABEL[kind] || kind}
              <span className={`ml-1 font-semibold ${dark ? "text-slate-600" : "text-slate-400"}`}>
                {list.length}
              </span>
            </header>
            <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((room) => {
                const session = sessionByRoomId?.get(room.id) || null;
                const occupants = session?.occupants || [];
                const locked = lockedRoomIds?.has(room.id) || false;
                // Private rooms: dynamic lock — open while empty, locked once occupied.
                const RoomIcon = room.kind === "private"
                  ? (occupants.length > 0 ? Lock : LockOpen)
                  : (KIND_ICON[room.kind] || Hash);
                // Same faint room-color wash as the floor tiles, so the
                // two hallway views read as the same place.
                const tint = room.color || "#14b8a6";
                return (
                  <li key={room.id}>
                    <button
                      type="button"
                      data-tour="room-tile"
                      onClick={() => onEnterRoom?.(room.id)}
                      title={locked ? `${lockedReasonFor(room)} — knock to ask to be let in` : room.name}
                      style={{ background: `color-mix(in srgb, ${tint} 10%, var(--color-surface))` }}
                      className={`group w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-2 transition-colors hover:border-[var(--color-accent)] ${
                        locked ? "opacity-75" : ""
                      } ${
                        dark
                          ? "border-[var(--color-border)]"
                          : "border-slate-200"
                      }`}
                    >
                      <span className="p-1.5 rounded-lg shrink-0 bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                        <RoomIcon className="w-3.5 h-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-xs font-semibold truncate ${
                          dark ? "text-slate-100" : "text-slate-800"
                        }`}>
                          {room.name}
                        </span>
                        {locked ? (
                          <span className={`block text-[10px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                            Locked
                          </span>
                        ) : occupants.length > 0 ? (
                          // Who's in here — stacked avatars with a presence-colored
                          // ring so the list view answers "who can I go talk to"
                          // at a glance, not just a headcount.
                          <span className="mt-1 flex items-center gap-1">
                            <span className="flex -space-x-1.5">
                              {occupants.slice(0, 5).map((o) => (
                                <span key={o.user_id} title={o.name} className="inline-flex">
                                  <UserAvatar
                                    url={o.avatar_url}
                                    name={o.name}
                                    size={20}
                                    className={`ring-2 ${availabilityRing(shownAvailability(o.user_id, o.presence_state, presenceById))}`}
                                  />
                                </span>
                              ))}
                            </span>
                            {occupants.length > 5 && (
                              <span className={`text-[10px] font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}>
                                +{occupants.length - 5}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className={`block text-[10px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                            Empty
                          </span>
                        )}
                      </span>
                      {locked ? (
                        <Lock className="w-3 h-3 shrink-0 opacity-60" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
