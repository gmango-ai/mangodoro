import { useEffect, useState } from "react";
import { Video, MessageSquare, PenLine, Timer, Users } from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import DevicePortalCall from "../../video/DevicePortalCall";
import UserAvatar from "../../UserAvatar";

// The KIOSK panel registry — the device-side counterpart to panels.jsx
// (ROOM_PANELS). Same shape ({ id, title, icon, min, render(ctx) }) so it drops
// straight into the shared <RoomLayout panels={DEVICE_PANELS}> + useRoomLayout.
// Differences from the member set:
//   • video   → the always-on DevicePortalCall (kiosk portal), not RoomVideoStage.
//   • chat    → RoomChatPanel in readOnly mode (the device can't post).
//   • + timer + presence widgets (a communal display wants these glanceable).
// ctx = { room, userId, displayName, dark, sess, participants, whiteboardId }.

const MODE_LABEL = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

function fmtClock(s) {
  const mm = String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0");
  const ss = String(Math.max(0, s) % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Self-ticking so the layout doesn't have to re-render every second — the panel
// owns its countdown from the session's ends_at (running) or remaining_seconds.
function DeviceTimerPanel({ sess }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!sess?.is_running) return undefined;
    const id = setInterval(() => force((n) => (n + 1) % 1e9), 500);
    return () => clearInterval(id);
  }, [sess?.is_running, sess?.ends_at]);

  const secondsLeft = (() => {
    if (!sess) return 0;
    if (sess.is_running && sess.ends_at) {
      return Math.max(0, Math.ceil((new Date(sess.ends_at).getTime() - Date.now()) / 1000));
    }
    return Math.max(0, sess.remaining_seconds || 0);
  })();
  const isBreak = sess && sess.mode !== "work";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-white p-4">
      {sess ? (
        <>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.25em] mb-2 ${isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]"}`}>
            {MODE_LABEL[sess.mode] || "Focus"}{!sess.is_running ? " · Paused" : ""}
          </div>
          <div
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: "clamp(2.5rem, 14vw, 9rem)", fontFamily: "'Parkinsans', sans-serif", letterSpacing: "0.01em" }}
          >
            {fmtClock(secondsLeft)}
          </div>
        </>
      ) : (
        <p className="text-slate-500 text-sm text-center">No active session.<br />Waiting for someone to start the timer…</p>
      )}
    </div>
  );
}

function DevicePresencePanel({ participants }) {
  const list = participants || [];
  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-3">
        {list.length} here
      </div>
      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">No one's in the session yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {list.map((p) => (
            <div key={p.user_id} className="flex flex-col items-center gap-1.5 w-16">
              <UserAvatar url={p.avatar_url || ""} name={p.display_name || "Member"} size={44} />
              <span className="text-[11px] text-slate-400 truncate max-w-full">{p.display_name || "Member"}</span>
            </div>
          ))}
        </div>
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
    render: ({ room, displayName }) => <DevicePortalCall roomId={room.id} displayName={displayName} />,
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
    render: ({ participants }) => <DevicePresencePanel participants={participants} />,
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
    // Device can't link or edit (RLS is SELECT-only); shows the room's linked board.
    render: ({ whiteboardId, dark }) => <RoomWhiteboardPanel whiteboardId={whiteboardId} canLink={false} dark={dark} />,
  },
};

export const DEVICE_PANEL_IDS = Object.keys(DEVICE_PANELS);
