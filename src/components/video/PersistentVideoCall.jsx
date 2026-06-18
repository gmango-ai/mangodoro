import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useVideoCall } from "../../context/VideoCallContext";
import VideoCall from "./VideoCall";

// Persistent container for the active Jitsi room call. Lives at the
// AppLayout level so it never unmounts when the user navigates between
// /office and other pages — the Jitsi iframe stays put in the DOM,
// the conference stays connected.
//
// Positioning has two modes:
//   • Stage mode  — the current page has provided a stageEl (e.g.
//                   RoomVideoStage). We continuously sync our fixed-
//                   position rectangle to that element's bounding
//                   rect so the call appears "inside" the page chrome.
//   • PiP mode    — no stageEl. We render a small floating window in
//                   the bottom-right corner with a header that says
//                   what room you're still in, a "back to room"
//                   button, and a leave-call X.
//
// We do NOT use a portal because moving an <iframe> between DOM
// parents triggers a browser reload (Chrome/Safari security behavior).
// CSS-positioning a single fixed container avoids that entirely.

const PIP_WIDTH = 320;
const PIP_HEIGHT = 200;
const PIP_MARGIN = 16;

function pipRect() {
  // bottom-right at the time we compute. Window-resize is handled via
  // the effect below — we recompute on every resize.
  if (typeof window === "undefined") return null;
  return {
    top: window.innerHeight - PIP_HEIGHT - PIP_MARGIN,
    left: window.innerWidth - PIP_WIDTH - PIP_MARGIN,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
  };
}

export default function PersistentVideoCall() {
  const { call, endCall, stageEl } = useVideoCall();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [rect, setRect] = useState(null);

  // Sync rect to stageEl (or PiP) every time stageEl changes, the
  // stage resizes, or the window resizes. ResizeObserver on the stage
  // catches splits/resizes inside RoomView; a resize listener catches
  // window changes.
  useLayoutEffect(() => {
    if (!call) {
      setRect(null);
      return;
    }
    let cancelled = false;
    function update() {
      if (cancelled) return;
      if (stageEl) {
        const r = stageEl.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(pipRect());
      }
    }
    update();

    const ro = stageEl ? new ResizeObserver(update) : null;
    if (stageEl && ro) ro.observe(stageEl);
    window.addEventListener("resize", update);
    // Scroll inside ancestors can also move the stage rect.
    window.addEventListener("scroll", update, true);

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [stageEl, call]);

  if (!call || !rect) return null;
  const inPiP = !stageEl;

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        // z above body content but below ESC-able modals (z-[180]+).
        zIndex: 150,
        transition: inPiP ? "top 0.18s ease, left 0.18s ease" : "none",
      }}
      className={inPiP ? "rounded-xl shadow-2xl overflow-hidden bg-slate-900 border border-slate-700" : ""}
    >
      {/* The actual call. key=roomId so changing rooms re-mounts the
          iframe (the Jitsi conference name is room-derived). */}
      <VideoCall
        key={call.roomId}
        roomId={call.roomId}
        displayName={call.displayName}
        onLeft={() => endCall()}
      />

      {/* PiP-only chrome: a thin header with a "back to room" button
          and a leave-call X. We overlay it on top of the iframe (the
          iframe has its own toolbar; this is the app-shell layer). */}
      {inPiP && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between gap-2 px-2 py-1 bg-slate-900/80 backdrop-blur-sm text-white text-[11px] font-semibold pointer-events-none"
        >
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
    </div>
  );
}
