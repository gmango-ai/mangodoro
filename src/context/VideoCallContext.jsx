import { createContext, useCallback, useContext, useMemo, useState } from "react";

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

  // opts.mode: "join" (publish camera/mic) | "spectate" (subscribe-only —
  // see/hear everyone without publishing). opts.choices: device prefs from
  // the pre-join card ({ videoEnabled, audioEnabled, videoDeviceId,
  // audioDeviceId }).
  const startCall = useCallback((roomId, displayName, opts = {}) => {
    if (!roomId) return;
    setCall({
      roomId,
      displayName: displayName || "",
      mode: opts.mode || "join",
      choices: opts.choices || null,
    });
  }, []);

  const endCall = useCallback(() => {
    setCall(null);
    setStageElRaw(null);
  }, []);

  // Patch the live call without re-creating it — used to flip a spectator
  // into a publisher ("Join in") without changing the room/identity.
  const updateCall = useCallback((partial) => {
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
