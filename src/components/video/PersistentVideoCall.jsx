import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useVideoCall } from "../../context/VideoCallContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import VideoCall from "./VideoCall";

// Persistent container for the active room call. Lives at the AppLayout level so
// it never unmounts when the user navigates — the LiveKit connection stays up.
//
// Positioning: we portal the call into a STABLE host <div> that we physically
// move between two parents:
//   • Stage mode — appended INSIDE the page's stageEl (RoomVideoStage's tile),
//     position:absolute inset-0, so the call fills that tile and SCROLLS NATIVELY
//     with the page. (The old code fixed-positioned it to the viewport and chased
//     the stage rect with a JS scroll handler + React setState, which always
//     lagged a frame behind native scroll — the "video falls out of its frame".)
//   • PiP mode  — appended to <body>, position:fixed bottom-right, a floating
//     window with a back-to-room + leave-call header.
//
// Re-parenting the host node is safe now that the call is LiveKit <video>
// elements: moving a <video> in the DOM keeps it playing. (The old comment here
// said we COULDN'T move it — that was the Jitsi <iframe>, which reloads when
// re-parented. Jitsi is retired, so the constraint, and all the rect-tracking
// it forced, is gone.)

const PIP_CSS =
  "position:fixed;bottom:16px;right:16px;width:320px;height:200px;z-index:120;" +
  "border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);" +
  "background:#0f172a;border:1px solid rgb(51,65,85);";
// Sits just above the room tiles but below in-room chrome (menus/modals portal to
// <body> at higher z), so the call never traps a control behind it.
const STAGE_CSS = "position:absolute;inset:0;z-index:20;";

export default function PersistentVideoCall() {
  const { call, startCall, endCall, updateCall, stageEl } = useVideoCall();
  const { syncSession } = useSyncSession();
  const navigate = useNavigate();

  // Stable host node: created once, moved between parents, never unmounted — so
  // the portaled <VideoCall> (and its LiveKit room) survives navigation.
  const hostRef = useRef(null);
  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
  }
  const [inPiP, setInPiP] = useState(false);

  // Bind the call's lifetime to the room's sync session, and handle carry-over:
  // when you move from one room to another while in a call, the call FOLLOWS you
  // (re-joins the new room) rather than ending — the only "auto-join" path.
  // Leaving to the hallway (curRoom null) tears the call down. A fresh entry from
  // the hallway with no active call shows the pre-join card (see RoomVideoStage).
  const prevSessionRoomRef = useRef(syncSession?.room_id || null);
  useEffect(() => {
    const prevRoom = prevSessionRoomRef.current;
    const curRoom = syncSession?.room_id || null;
    prevSessionRoomRef.current = curRoom;
    if (call && prevRoom && curRoom !== prevRoom && call.roomId === prevRoom) {
      if (curRoom) {
        startCall(curRoom, call.displayName, { mode: call.mode, choices: call.choices });
      } else {
        endCall();
      }
    }
  }, [syncSession?.room_id, call, startCall, endCall]);

  // Place the host: inside the stage (scrolls natively) or floating PiP. No rect
  // tracking, no scroll/resize listeners — fixed bottom/right auto-tracks window
  // resize, and absolute inset-0 auto-tracks the tile's scroll/resize.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !call) return undefined;
    if (stageEl) {
      host.style.cssText = STAGE_CSS;
      stageEl.appendChild(host);
      setInPiP(false);
    } else {
      host.style.cssText = PIP_CSS;
      document.body.appendChild(host);
      setInPiP(true);
    }
    return () => { try { host.remove(); } catch { /* */ } };
  }, [stageEl, call]);

  if (!call || !hostRef.current) return null;

  return createPortal(
    <>
      {/* The actual call. key=roomId so changing rooms re-mounts it (carry-over
          into a new room is a fresh connection). */}
      <VideoCall
        key={call.roomId}
        roomId={call.roomId}
        displayName={call.displayName}
        compact={inPiP}
        publish={call.mode !== "spectate"}
        choices={call.choices}
        onJoinIn={() => updateCall({ mode: "join" })}
        onLeft={() => endCall()}
      />

      {/* PiP-only chrome: a thin header with back-to-room + leave-call. */}
      {inPiP && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-2 px-2 py-1 bg-slate-900/80 backdrop-blur-sm text-white text-[11px] font-semibold pointer-events-none">
          <span className="truncate pointer-events-none">In call</span>
          <div className="flex items-center gap-1 pointer-events-auto">
            <button
              type="button"
              onClick={() => navigate(`/office/r/${call.roomId}`)}
              aria-label="Back to room"
              title="Back to room"
              className="p-1 rounded hover:bg-white/10"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => endCall()}
              aria-label="Leave call"
              title="Leave call"
              className="p-1 rounded hover:bg-red-500/40"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </>,
    hostRef.current,
  );
}
