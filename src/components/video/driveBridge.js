// Module-level bridge between the live call (LiveKitCall internals) and the
// drive-mode screen. Mic state and the toggle live deep inside LiveKitCall;
// drive mode needs them without mounting anything in the LiveKit tree, and
// without adding call-state churn to VideoCallContext (whose consumers are
// app-wide). Same singleton pattern as useClockedIn: report + subscribe.

let _state = { connected: false, micMuted: false, speakerName: "", participantCount: 0 };
const _subs = new Set();
let _controls = null;

export function driveCallState() { return _state; }

export function subscribeDriveCall(fn) {
  _subs.add(fn);
  fn(_state);
  return () => _subs.delete(fn);
}

export function reportDriveCall(partial) {
  let changed = false;
  for (const k of Object.keys(partial)) {
    if (_state[k] !== partial[k]) { changed = true; break; }
  }
  if (!changed) return;
  _state = { ..._state, ...partial };
  for (const fn of _subs) fn(_state);
}

// Back to the resting state when the call unmounts, so a later drive-mode
// visit doesn't show a stale "connected" flash before the next report.
export function resetDriveCall() {
  reportDriveCall({ connected: false, micMuted: false, speakerName: "", participantCount: 0 });
}

export function registerDriveControls(api) { _controls = api; }

export function driveToggleMic() { _controls?.toggleMic?.(); }
