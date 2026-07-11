import { useMemo, useState } from "react";
import { Video, MessageSquare, PenLine, Timer, Users, CalendarClock } from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import DevicePortalCall from "../../video/DevicePortalCall";
import UserAvatar from "../../UserAvatar";
import { formatClock } from "../../../lib/utils";
import { useVisibilityPausedInterval } from "../../../hooks/useVisibilityPausedInterval";
import { availabilityDot, availabilityLabel } from "../../../lib/presence";
import { mergeOfficePresence } from "../../../lib/officePresence";

// The KIOSK panel registry — the device-side counterpart to panels.jsx
// (ROOM_PANELS). Same shape ({ id, title, icon, min, render(ctx) }) so it drops
// straight into the shared <RoomLayout panels={DEVICE_PANELS}> + useRoomLayout.
// Differences from the member set:
//   • video   → the always-on DevicePortalCall (kiosk portal), not RoomVideoStage.
//   • chat    → RoomChatPanel in readOnly mode (the device can't post).
//   • + timer + presence widgets (a communal display wants these glanceable).
// ctx = { room, userId, displayName, dark, sess, participants, whiteboardId }.

const MODE_LABEL = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

// Self-ticking so the layout doesn't have to re-render every second — the panel
// owns its countdown from the session's ends_at (running) or remaining_seconds.
export function DeviceTimerPanel({ sess }) {
  const [, force] = useState(0);
  useVisibilityPausedInterval(
    () => force((n) => (n + 1) % 1e9),
    1000,
    { enabled: !!sess?.is_running }
  );

  const secondsLeft = (() => {
    if (!sess) return 0;
    if (sess.is_running && sess.ends_at) {
      return Math.max(0, Math.ceil((new Date(sess.ends_at).getTime() - Date.now()) / 1000));
    }
    return Math.max(0, sess.remaining_seconds || 0);
  })();
  const isBreak = sess && sess.mode !== "work";

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-white p-4 overflow-hidden"
      style={{ containerType: "size" }}
    >
      {sess ? (
        <>
          <div className={`font-semibold uppercase tracking-[0.25em] mb-2 ${isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]"}`}
            style={{ fontSize: "clamp(9px, 3.5cqmin, 15px)" }}>
            {MODE_LABEL[sess.mode] || "Focus"}{!sess.is_running ? " · Paused" : ""}
          </div>
          <div
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: "min(26cqw, 52cqh)", fontFamily: "'Parkinsans', sans-serif", letterSpacing: "0.01em" }}
          >
            {formatClock(secondsLeft, { padMinutes: true })}
          </div>
        </>
      ) : (
        <p className="text-slate-500 text-sm text-center">No active session.<br />Waiting for someone to start the timer…</p>
      )}
    </div>
  );
}

// Full-org roster for the wall display: EVERYONE grouped by where they are —
// this room first, then other rooms, the hallway, away, offline. Reads the
// device_team_roster RPC (org-wide identity + status + location) and reuses the
// same mergeOfficePresence liveness the member surfaces use (no realtime roster
// on a device, so liveness is heartbeat-only). Replaces the old room-only
// "Who's here" list.
function DeviceTeamRoster({ roster, currentRoomId }) {
  const { people, roomNameById } = useMemo(() => {
    const rows = roster || [];
    const identity = {};
    const names = {};
    for (const r of rows) {
      identity[r.user_id] = { name: r.display_name, avatar: r.avatar_url };
      if (r.location_room_id && r.room_name) names[r.location_room_id] = r.room_name;
    }
    return { people: mergeOfficePresence(rows, [], identity), roomNameById: names };
  }, [roster]);

  const groups = useMemo(() => {
    const roomsG = new Map();
    const around = [], awayList = [], offline = [];
    for (const p of people) {
      if (p.locationKind === "room" && p.locationRoomId) {
        if (!roomsG.has(p.locationRoomId)) roomsG.set(p.locationRoomId, []);
        roomsG.get(p.locationRoomId).push(p);
        continue;
      }
      if (!p.online) { (p.availability === "offline" ? offline : awayList).push(p); continue; }
      around.push(p);
    }
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    const roomEntries = [...roomsG.entries()];
    const out = [];
    const cur = currentRoomId ? roomEntries.find(([rid]) => rid === currentRoomId) : null;
    if (cur) out.push({ key: `room:${cur[0]}`, label: "In this room", people: cur[1].sort(byName), highlight: true });
    roomEntries.filter(([rid]) => rid !== currentRoomId)
      .sort((a, b) => (roomNameById[a[0]] || "").localeCompare(roomNameById[b[0]] || ""))
      .forEach(([rid, list]) => out.push({ key: `room:${rid}`, label: roomNameById[rid] || "A room", people: list.sort(byName) }));
    if (around.length) out.push({ key: "around", label: "In the hallway", people: around.sort(byName) });
    if (awayList.length) out.push({ key: "away", label: "Away", people: awayList.sort(byName) });
    if (offline.length) out.push({ key: "offline", label: "Offline", people: offline.sort(byName), muted: true });
    return out;
  }, [people, roomNameById, currentRoomId]);

  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      {people.length === 0 ? (
        <p className="text-slate-500 text-sm">No teammates yet.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${g.highlight ? "text-[var(--color-accent)]" : "text-white/45"}`}>
                {g.label} <span className="tabular-nums opacity-70">{g.people.length}</span>
              </div>
              <ul className="space-y-1.5">
                {g.people.map((p) => {
                  const activity = p.online && p.activity?.label ? p.activity.label : null;
                  return (
                    <li key={p.userId} className="flex items-center gap-2.5 min-w-0">
                      <span className="relative shrink-0">
                        <UserAvatar url={p.avatar} name={p.name || "Member"} size={30} />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 ${availabilityDot(p.availability)}`} />
                      </span>
                      <span className="min-w-0 flex flex-col leading-tight">
                        <span className={`text-[12px] font-medium truncate ${g.muted || !p.online ? "text-white/45" : "text-white/90"}`}>{p.name || "Member"}</span>
                        <span className="text-[10px] text-white/50 truncate">{activity || availabilityLabel(p.availability)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact "when" for a meeting on a glanceable display: the clock time, plus a
// relative hint while it's close ("now" / "in 8 min" / "in progress"), and the
// weekday prefix once it's not today.
export function fmtMeetingWhen(startsAt) {
  const d = new Date(startsAt);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const mu = (d.getTime() - Date.now()) / 60000;
  if (mu <= -1) return `${t} · in progress`;
  if (mu < 1) return `${t} · now`;
  if (mu < 60) return `${t} · in ${Math.round(mu)} min`;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

// The room's upcoming meetings as a layout tile (device parity with the member
// "Meetings" view). Reads scheduled_meetings for this room (RLS-scoped); an
// imminent meeting is accented, matching the page-level alert.
function DeviceMeetingsPanel({ meetings }) {
  const now = Date.now();
  const list = (meetings || []).filter((m) => new Date(m.ends_at).getTime() > now);
  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-3">Meetings</div>
      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">No meetings scheduled for this room.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((m) => {
            const mu = (new Date(m.starts_at).getTime() - now) / 60000;
            const soon = mu <= 10 && mu >= -2;
            return (
              <li key={m.id} className="flex items-start gap-3 min-w-0">
                <span className={`mt-1 shrink-0 w-2 h-2 rounded-full ${soon ? "bg-[var(--color-accent)]" : "bg-white/25"}`} />
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-[13px] font-medium text-white/90 truncate">{m.title || "Meeting"}</span>
                  <span className={`text-[11px] truncate ${soon ? "text-[var(--color-accent)]" : "text-white/55"}`}>{fmtMeetingWhen(m.starts_at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const DEVICE_PANELS = {
  video: {
    id: "video",
    title: "Video",
    icon: Video,
    min: 280,
    // key by room.id so a room switch cleanly remounts the call (fresh LiveKit
    // connection to the new room) rather than trying to reuse the old one.
    // active = a human is in the call; the portal stays idle (no LiveKit media)
    // until then, so the kiosk doesn't publish 24/7.
    render: ({ room, displayName, someoneInCall }) => (
      <DevicePortalCall key={room.id} roomId={room.id} displayName={displayName} active={!!someoneInCall} />
    ),
  },
  timer: {
    id: "timer",
    title: "Timer",
    icon: Timer,
    min: 200,
    render: ({ sess }) => <DeviceTimerPanel sess={sess} />,
  },
  presence: {
    id: "presence",
    title: "Team",
    icon: Users,
    min: 200,
    render: ({ roster, currentRoomId }) => <DeviceTeamRoster roster={roster} currentRoomId={currentRoomId} />,
  },
  meetings: {
    id: "meetings",
    title: "Meetings",
    icon: CalendarClock,
    min: 200,
    render: ({ meetings }) => <DeviceMeetingsPanel meetings={meetings} />,
  },
  chat: {
    id: "chat",
    title: "Chat",
    icon: MessageSquare,
    min: 200,
    render: ({ room, userId }) => <RoomChatPanel roomId={room.id} userId={userId} fillHeight readOnly />,
  },
  whiteboard: {
    id: "whiteboard",
    title: "Whiteboard",
    icon: PenLine,
    min: 360,
    // Device can't link or edit (RLS is SELECT-only); shows the room's linked
    // board as a live, view-only canvas.
    render: ({ whiteboardId, dark }) => <RoomWhiteboardPanel whiteboardId={whiteboardId} canLink={false} dark={dark} readOnly />,
  },
};

export const DEVICE_PANEL_IDS = Object.keys(DEVICE_PANELS);
