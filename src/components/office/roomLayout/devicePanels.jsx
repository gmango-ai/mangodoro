import { useState } from "react";
import { Video, MessageSquare, PenLine, Timer, Users } from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import DevicePortalCall from "../../video/DevicePortalCall";
import UserAvatar from "../../UserAvatar";
import { formatClock } from "../../../lib/utils";
import { useVisibilityPausedInterval } from "../../../hooks/useVisibilityPausedInterval";
import { availabilityRing, availabilityDot, availabilityLabel, normAvailability } from "../../../lib/presence";

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

// The status a room occupant shows: their manual override (while unexpired),
// else the resolved user_presence.availability; invisible reads as offline (as
// on the member surfaces). Falls back to "online" when there's no snapshot yet
// for a present participant. Mirrors the display logic in officePresence, kept
// deliberately small since the kiosk reads only its own room's rows (RLS).
function effectiveAvailability(row) {
  if (!row) return "online";
  if (row.invisible) return "offline";
  const now = Date.now();
  if (row.override_availability && (!row.override_expires_at || new Date(row.override_expires_at).getTime() > now)) {
    return normAvailability(row.override_availability);
  }
  return normAvailability(row.availability);
}

// "Who's here" — the room's people with LIVE status. Each session participant
// (which carries the name + avatar the device is allowed to read) is joined to
// its user_presence row (readable now that the device has a room-scoped SELECT
// policy) so the wall display shows the same 7-state availability rings/labels
// the members see, not just a flat avatar list.
function DevicePresencePanel({ participants, presenceById }) {
  const list = participants || [];
  const byId = presenceById && typeof presenceById.get === "function" ? presenceById : null;
  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-3">
        {list.length} here
      </div>
      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">No one's in the session yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((p) => {
            const row = byId ? byId.get(p.user_id) : null;
            const av = effectiveAvailability(row);
            const activity = row && !row.activity_private && row.activity_label ? row.activity_label : null;
            const status = availabilityLabel(av);
            return (
              <li key={p.user_id} className="flex items-center gap-3 min-w-0">
                <span className={`relative inline-flex shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-slate-950 ${availabilityRing(av)}`}>
                  <UserAvatar url={p.avatar_url || ""} name={p.display_name || "Member"} size={40} />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-slate-950 ${availabilityDot(av)}`} />
                </span>
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-[13px] font-medium text-white/90 truncate">{p.display_name || "Member"}</span>
                  <span className="text-[11px] text-white/55 truncate">
                    {activity ? `${status} · ${activity}` : status}
                  </span>
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
    render: ({ room, displayName }) => <DevicePortalCall key={room.id} roomId={room.id} displayName={displayName} />,
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
    title: "Who's here",
    icon: Users,
    min: 180,
    render: ({ participants, presenceById }) => <DevicePresencePanel participants={participants} presenceById={presenceById} />,
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
