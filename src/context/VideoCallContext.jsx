import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { logCallEvent } from "../components/video/livekitDiagnostics";

// Owns the *one* active Jitsi room call across the whole app session.
// The actual iframe is mounted exactly once at AppLayout (via
// PersistentVideoCall) and never re-parented, so navigating between
// /office and /pomodoro / settings / etc. doesn't drop the call.
//
// State:
//   call         — { roomId, displayName } | null. Truthy = call alive.
//   stageEl      — the DOM element on the current page where the call
//                  should visually "live" (e.g. RoomVideoStage's
//                  container). When set, PersistentVideoCall syncs
//                  its fixed-position rectangle to this element's
//                  bounding rect. When null, it falls back to a
//                  bottom-right PiP.
//
// Why a context (vs Redux/Zustand/etc): this is a single-pair state
// + setStageEl callback; context with React state is the smallest
// thing that fits.

const VideoCallContext = createContext(null);

export function VideoCallProvider({ children }) {
  const [call, setCall] = useState(null);
  const [stageEl, setStageElRaw] = useState(null);
  // Mirror `call` into a ref so the stable (deps-free) start/end callbacks can
  // read the current room for logging without taking `call` as a dep (which
  // would change their identity and re-fire RoomVideoStage's effects).
  const callRef = useRef(null);
  callRef.current = call;

  // opts.mode: "join" (publish camera/mic) | "spectate" (subscribe-only —
  // see everyone without publishing). opts.choices: device prefs from the
  // pre-join card ({ videoEnabled, audioEnabled, videoDeviceId, audioDeviceId }).
  // opts.listen: whether a spectator HEARS the call. Defaults true; a silent
  // auto-preview passes false so walking up to a room doesn't blast its audio
  // (and can't feed back through a nearby participant's mic). Ignored once you
  // publish — joining always hears.
  const startCall = useCallback((roomId, displayName, opts = {}) => {
    if (!roomId) return;
    const prev = callRef.current;
    // "switch" = carry-over into a different room (a fresh connection); "start" =
    // first join. Either way the VideoCall re-keys on roomId and reconnects.
    logCallEvent(prev && prev.roomId !== roomId ? "switch" : "start", {
      roomId,
      from: prev?.roomId || null,
      mode: opts.mode || "join",
    });
    setCall({
      roomId,
      displayName: displayName || "",
      mode: opts.mode || "join",
      choices: opts.choices || null,
      listen: opts.listen !== false,
    });
  }, []);

  // reason — a short string for WHY the call is ending (user leave, sync-session
  // room cleared, etc.). Logged so a teardown that wasn't a user action stands
  // out as a candidate for the "force disconnect" bug.
  const endCall = useCallback((reason) => {
    const prev = callRef.current;
    if (prev) logCallEvent("end", { roomId: prev.roomId, reason: reason || "unspecified" });
    setCall(null);
    setStageElRaw(null);
  }, []);

  // Patch the live call without re-creating it — used to flip a spectator
  // into a publisher ("Join in") without changing the room/identity.
  const updateCall = useCallback((partial) => {
    logCallEvent("update", partial);
    setCall((c) => (c ? { ...c, ...partial } : c));
  }, []);

  // Stable identity for the setter so RoomVideoStage's useEffect
  // doesn't re-fire on every parent render.
  const setStageEl = useCallback((el) => setStageElRaw(el), []);

  const value = useMemo(
    () => ({ call, stageEl, startCall, endCall, updateCall, setStageEl }),
    [call, stageEl, startCall, endCall, updateCall, setStageEl],
  );

  return (
    <VideoCallContext.Provider value={value}>
      {children}
    </VideoCallContext.Provider>
  );
}

export function useVideoCall() {
  const ctx = useContext(VideoCallContext);
  if (!ctx) throw new Error("useVideoCall must be used within a VideoCallProvider");
  return ctx;
}
