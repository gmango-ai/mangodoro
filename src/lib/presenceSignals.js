// Map the app's live context state onto the resolver's Signals contract.
// Kept PURE (no hooks, no I/O) so the mapping is unit-testable; the React glue
// (src/components/PresenceResolver.jsx) just snapshots context into this.
//
// Not wired yet: `override` (arrives with the status-setter UI), `pairingWith`
// / `huddle` and `carBluetooth` (Phase 2), `calendar` (Phase 3). The resolver
// already handles them; buildSignals will pass them through as they land.

export function buildSignals({
  clockIn,          // AppContext.clockIn: null when clocked out
  currentTask,      // AppContext.currentTask: { id, description, started_at } | null
  room,             // resolved room row: { id, name, kind } | null
  pomodoro,         // { isRunning, mode } | null
  lastActivityMs,   // epoch ms of last input activity (localStorage mango:lastActivity)
  online = true,
  now,
} = {}) {
  const clock = clockIn
    ? {
        clockedIn: true,
        onBreak: !!clockIn.activeBreak,
        breakKind: clockIn.activeBreak?.kind,
      }
    : null;

  const activity = currentTask?.description
    ? {
        kind: "task",
        label: currentTask.description,
        since: currentTask.started_at ? Date.parse(currentTask.started_at) || undefined : undefined,
      }
    : null;

  return {
    now,
    online,
    idleMs: lastActivityMs != null ? Math.max(0, now - lastActivityMs) : undefined,
    room: room ? { id: room.id, name: room.name, kind: room.kind } : null,
    clock,
    pomodoro: pomodoro ? { running: !!pomodoro.isRunning, mode: pomodoro.mode } : null,
    activity,
  };
}
