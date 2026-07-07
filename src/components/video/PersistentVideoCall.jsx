import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Car, Maximize2, PhoneOff, PictureInPicture2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useVideoCall } from "../../context/VideoCallContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useTheme } from "../../context/ThemeContext";
import { resolveVideoProvider, VIDEO } from "../../lib/videoProvider";
import { cloneDocStyles, copyRootCustomProps } from "../pomodoro/PomodoroPipParts";
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
// On phones the floating video window is unusable (covers the page, controls
// too small to hit), so the host parks offscreen-invisible — audio keeps
// playing — and a compact "in call" pill below carries the actions instead.
const PIP_HIDDEN_CSS =
  "position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0;" +
  "pointer-events:none;overflow:hidden;";
const IS_TOUCH =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const STAGE_CSS = "position:absolute;inset:0;z-index:20;";
// Maximized: the host covers the viewport (below the drive overlay's z-200,
// above nav/PiP). Safe-area padding keeps the stage out of the notch.
const MAX_CSS =
  "position:fixed;inset:0;z-index:130;background:#0f172a;box-sizing:border-box;" +
  "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";

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
  const { call, startCall, endCall, updateCall, stageEl, poppedOut, setPoppedOut, setCanPopOut, registerPopout, maximized, hideChrome } = useVideoCall();
  const { syncSession } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const reparentSafe = resolveVideoProvider() === VIDEO.LIVEKIT;
  const inPiP = !stageEl && !maximized;

  // Pop-out: move the (re-parentable) call host into an OS-level Document
  // Picture-in-Picture window that floats above other apps. Chromium/Electron
  // only (same API the pomodoro pop-out uses) — and LiveKit only, since moving a
  // Jitsi <iframe> reloads it. Moving the host node keeps the RTC + <video> live.
  // `poppedOut` lives in VideoCallContext so the (deeply-nested) call control bar
  // can drive it; we register the open/close implementation there below.
  const pipWinRef = useRef(null);
  const canPopOut =
    reparentSafe &&
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window;

  // Stable host node (LiveKit only): created once, moved between parents, never
  // unmounted — so the portaled <VideoCall> survives navigation.
  const hostRef = useRef(null);
  if (reparentSafe && hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
  }
  const [jitsiRect, setJitsiRect] = useState(null);

  // Collapse the call UI to compact when it's rendered in a tight area — PiP, or
  // the shrunk "others" corner of the pre-join — so the toolbar never overflows.
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (!reparentSafe) return undefined;
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setSmall(host.clientWidth > 0 && host.clientWidth < 380));
    ro.observe(host);
    return () => ro.disconnect();
  }, [reparentSafe]);
  const compact = inPiP || small || (!reparentSafe && !!jitsiRect && jitsiRect.width < 380);

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
        startCall(curRoom, call.displayName, { mode: call.mode, choices: call.choices, listen: call.listen });
      } else {
        // The sync session lost its room (left to the hallway, or the room reset
        // out from under us). This is the prime app-layer "force disconnect"
        // suspect — tag it so it's unmistakable in the log.
        endCall("sync-session-room-cleared");
      }
    }
  }, [syncSession?.room_id, call, startCall, endCall]);

  // LiveKit: place the host inside the stage (scrolls natively) or floating PiP.
  // Skipped while popped out — the pop-out window owns the host node then, and
  // this effect re-claims it when the window closes (poppedOut flips false).
  useLayoutEffect(() => {
    if (!reparentSafe || poppedOut) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    // Call ended: detach the host. In maximized mode it's a position:fixed
    // inset-0 overlay — leaving it attached (now empty, since the portal
    // renders null) covered the whole screen and stranded the user on a black
    // "call" screen after tapping Leave while fullscreen.
    if (!call) { try { host.remove(); } catch { /* */ } return undefined; }
    // appendChild MOVES the node (auto-detaching it from its old parent), so we
    // don't remove it on cleanup — doing so would yank the host straight back out
    // of the pop-out window the instant `poppedOut` flips (which showed a blank
    // window). Final teardown is handled by the unmount-only effect below.
    if (maximized) {
      host.style.cssText = MAX_CSS;
      document.body.appendChild(host);
    } else if (stageEl) {
      host.style.cssText = STAGE_CSS;
      stageEl.appendChild(host);
    } else {
      host.style.cssText = IS_TOUCH ? PIP_HIDDEN_CSS : PIP_CSS;
      document.body.appendChild(host);
    }
    try { host.querySelectorAll("video").forEach((v) => v.play?.().catch(() => {})); } catch { /* */ }
    return undefined;
  }, [stageEl, call, reparentSafe, poppedOut, maximized]);

  // Detach the host only when this component truly unmounts (sign-out).
  useEffect(() => () => { try { hostRef.current?.remove(); } catch { /* */ } }, []);

  // Open / close the Document PiP window (open must run from a user gesture).
  async function openPopOut() {
    const dpi = typeof window !== "undefined" ? window.documentPictureInPicture : null;
    const host = hostRef.current;
    if (!dpi?.requestWindow || !host) return;
    try {
      const pipWin = await dpi.requestWindow({ width: 400, height: 300, disallowReturnToOpener: false });
      pipWinRef.current = pipWin;
      cloneDocStyles(pipWin.document);
      copyRootCustomProps(pipWin.document);
      pipWin.document.documentElement.classList.toggle("dark", dark);
      const b = pipWin.document.body;
      pipWin.document.documentElement.style.height = "100%";
      b.style.margin = "0";
      b.style.height = "100%";
      b.style.overflow = "hidden";
      b.style.background = "#0f172a";
      host.style.cssText = "position:absolute;inset:0;";
      b.appendChild(host);
      // Moving a <video> across documents can pause it — nudge them back to play.
      try { host.querySelectorAll("video").forEach((v) => v.play?.().catch(() => {})); } catch { /* */ }
      setPoppedOut(true);
      pipWin.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        setPoppedOut(false); // the re-parent effect above pulls the host back in
      });
    } catch { /* user dismissed / unsupported / already open */ }
  }
  function closePopOut() {
    try { pipWinRef.current?.close(); } catch { /* */ }
    pipWinRef.current = null;
    setPoppedOut(false);
  }
  // The call ending while popped out closes the window; theme changes re-mirror.
  useEffect(() => { if (!call && pipWinRef.current) closePopOut(); }, [call]);
  useEffect(() => {
    const w = pipWinRef.current;
    if (!w?.document?.documentElement) return;
    w.document.documentElement.classList.toggle("dark", dark);
    copyRootCustomProps(w.document);
  }, [dark, poppedOut]);

  // Publish the pop-out controls + support flag to the context so the call
  // control bar (nested inside VideoCall) can trigger them. Register stable
  // wrappers that read the latest handlers via refs.
  const openRef = useRef(null); openRef.current = openPopOut;
  const closeRef = useRef(null); closeRef.current = closePopOut;
  useEffect(() => {
    registerPopout({ open: () => openRef.current?.(), close: () => closeRef.current?.() });
    return () => registerPopout(null);
  }, [registerPopout]);
  useEffect(() => { setCanPopOut(canPopOut); }, [canPopOut, setCanPopOut]);

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
        compact={compact}
        // The floating PiP has its own thin header (back-to-room + leave); the
        // full control bar only renders when a page stages the call. Drive mode
        // stages the video but supplies its own giant controls (hideChrome).
        hideControls={inPiP || hideChrome}
        publish={call.mode !== "spectate"}
        listen={call.listen !== false}
        choices={call.choices}
        // While spectating, the call fills the tile but its own control bar is
        // suppressed — the Lobby (RoomVideoStage) overlays the only dock, with
        // Join / Watch / settings. Avoids two stacked bottom bars.
        chromeless={call.mode === "spectate"}
        onJoinIn={() => updateCall({ mode: "join" })}
        onLeft={() => endCall("livekit-disconnected")}
      />

      {/* In-app PiP chrome: a thin header with back-to-room + leave. (Pop-out
          lives in the call control bar's More menu now.) Hidden once popped out —
          that header lives in the OS window then. */}
      {inPiP && !poppedOut && !IS_TOUCH && (
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
              onClick={() => endCall("user-leave-pip")}
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
    return (
      <>
        {createPortal(content, hostRef.current)}
        {/* Mobile stand-in for the hidden floating window: the call is
            audio-only in the background; this pill is how you get back to it
            (room stage / drive mode) or hang up. */}
        {inPiP && !poppedOut && IS_TOUCH && (
          <div
            className="fixed inset-x-3 z-[120]"
            style={{ bottom: "calc(var(--bottom-inset) + 5.5rem)" }}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/95 text-white shadow-2xl px-4 py-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" aria-hidden />
              <span className="flex-1 min-w-0 text-sm font-semibold truncate">In call</span>
              <button
                type="button"
                onClick={() => navigate("/drive")}
                aria-label="Drive mode"
                className="flex items-center justify-center w-11 h-11 rounded-xl active:bg-white/10"
              >
                <Car className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => navigate(`/office/r/${call.roomId}`)}
                aria-label="Back to room"
                className="flex items-center justify-center w-11 h-11 rounded-xl active:bg-white/10"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => endCall("user-leave-pip")}
                aria-label="Leave call"
                className="flex items-center justify-center w-11 h-11 rounded-xl text-red-400 active:bg-red-500/20"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
        {/* While popped out the host lives in the OS window, so the app's slot is
            empty — leave a small card to bring it back. */}
        {poppedOut && (
          <div className="fixed bottom-4 right-4 z-[120] w-[220px] rounded-xl border border-slate-700 bg-slate-900/95 text-white shadow-2xl p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
              <PictureInPicture2 className="w-3.5 h-3.5" /> Call popped out
            </div>
            <p className="text-[11px] text-slate-400 mb-2">Your call is in a floating window.</p>
            <button
              type="button"
              onClick={closePopOut}
              className="w-full px-2 py-1.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs font-semibold"
            >
              Return to app
            </button>
          </div>
        )}
      </>
    );
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
