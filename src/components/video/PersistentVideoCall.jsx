import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useVideoCall } from "../../context/VideoCallContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { resolveVideoProvider, VIDEO } from "../../lib/videoProvider";
import VideoCall from "./VideoCall";

// Persistent container for the active room call. Lives at the AppLayout level so
// it never unmounts when the user navigates — the LiveKit connection stays up.
//
// Positioning (LiveKit): we portal the call into a STABLE host <div> that we
// physically move between two parents:
//   • Stage mode — appended INSIDE the page's stageEl (RoomVideoStage's tile),
//     position:absolute inset-0, so the call fills that tile and SCROLLS NATIVELY
//     with the page.
//   • PiP mode  — appended to <body>, position:fixed bottom-right, a floating
//     window with a back-to-room + leave-call header.
//
// Re-parenting the host node is safe for LiveKit <video> elements. Jitsi still
// embeds an <iframe> that reloads when re-parented, so the Jitsi fallback keeps
// a single fixed-position container and syncs its rect to the stage instead.

const PIP_CSS =
  "position:fixed;bottom:16px;right:16px;width:320px;height:200px;z-index:120;" +
  "border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);" +
  "background:#0f172a;border:1px solid rgb(51,65,85);";
const STAGE_CSS = "position:absolute;inset:0;z-index:20;";

const PIP_WIDTH = 320;
const PIP_HEIGHT = 200;
const PIP_MARGIN = 16;

function pipRect() {
  if (typeof window === "undefined") return null;
  return {
    top: window.innerHeight - PIP_HEIGHT - PIP_MARGIN,
    left: window.innerWidth - PIP_WIDTH - PIP_MARGIN,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
  };
}

export default function PersistentVideoCall() {
  const { call, startCall, endCall, updateCall, stageEl } = useVideoCall();
  const { syncSession } = useSyncSession();
  const navigate = useNavigate();
  const reparentSafe = resolveVideoProvider() === VIDEO.LIVEKIT;
  const inPiP = !stageEl;

  // Stable host node (LiveKit only): created once, moved between parents, never
  // unmounted — so the portaled <VideoCall> survives navigation.
  const hostRef = useRef(null);
  if (reparentSafe && hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
  }
  const [jitsiRect, setJitsiRect] = useState(null);

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

  // LiveKit: place the host inside the stage (scrolls natively) or floating PiP.
  useLayoutEffect(() => {
    if (!reparentSafe) return undefined;
    const host = hostRef.current;
    if (!host || !call) return undefined;
    if (stageEl) {
      host.style.cssText = STAGE_CSS;
      stageEl.appendChild(host);
    } else {
      host.style.cssText = PIP_CSS;
      document.body.appendChild(host);
    }
    return () => { try { host.remove(); } catch { /* */ } };
  }, [stageEl, call, reparentSafe]);

  // Jitsi: keep one fixed container — moving an iframe between parents reloads it.
  useLayoutEffect(() => {
    if (reparentSafe) {
      setJitsiRect(null);
      return undefined;
    }
    if (!call) {
      setJitsiRect(null);
      return undefined;
    }
    let cancelled = false;
    function update() {
      if (cancelled) return;
      if (stageEl) {
        const r = stageEl.getBoundingClientRect();
        setJitsiRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setJitsiRect(pipRect());
      }
    }
    update();

    const ro = stageEl ? new ResizeObserver(update) : null;
    if (stageEl && ro) ro.observe(stageEl);
    window.addEventListener("resize", update);
    if (stageEl) window.addEventListener("scroll", update, true);

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      window.removeEventListener("resize", update);
      if (stageEl) window.removeEventListener("scroll", update, true);
    };
  }, [stageEl, call, reparentSafe]);

  if (!call) return null;
  if (reparentSafe && !hostRef.current) return null;
  if (!reparentSafe && !jitsiRect) return null;

  const content = (
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
    </>
  );

  if (reparentSafe) {
    return createPortal(content, hostRef.current);
  }

  return (
    <div
      style={{
        position: "fixed",
        top: jitsiRect.top,
        left: jitsiRect.left,
        width: jitsiRect.width,
        height: jitsiRect.height,
        zIndex: inPiP ? 120 : 20,
        transition: inPiP ? "top 0.18s ease, left 0.18s ease" : "none",
      }}
      className={inPiP ? "rounded-xl shadow-2xl overflow-hidden bg-slate-900 border border-slate-700" : ""}
    >
      {content}
    </div>
  );
}
