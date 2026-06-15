import { UPDATED_AT_SKEW_MS } from "./constants.js";
import { remoteRemainingSeconds, remoteUpdatedAtMs } from "./derive.js";

export { remoteRemainingSeconds };

/**
 * Pure evaluation of whether a remote row should be applied or skipped.
 * Returns { action: "skip" | "apply", patch? }.
 *
 * Phase 1 of the server-authoritative migration: there is no longer a
 * "conflict" branch — any remote row that arrives newer than our last
 * local write is silently accepted. The previous manual "Use updated
 * timer" confirmation prompt was net-negative for trust: most users
 * want to stay in sync without being interrogated. Race protection
 * moves to the server in phase 2 (RPC operations + op_version).
 */
export function evaluateRemoteRow({
  row,
  force = false,
  lastLocalWriteAtMs,
  suppressUntilMs,
}) {
  if (!row || Date.now() < suppressUntilMs) {
    return { action: "skip" };
  }

  const remoteUpdatedMs = remoteUpdatedAtMs(row);
  const lastWriteMs = lastLocalWriteAtMs;

  // Still skip a stale Realtime payload that arrived after our newer
  // local write — that just keeps the optimistic UI from briefly
  // snapping backward to an out-of-order broadcast.
  if (
    !force &&
    remoteUpdatedMs != null &&
    lastWriteMs != null &&
    remoteUpdatedMs < lastWriteMs - UPDATED_AT_SKEW_MS
  ) {
    return { action: "skip" };
  }

  const nextMode = row.mode;
  const nextSessions = row.sessions;
  const nextPendingMode = row.pending_mode ?? null;
  const nextIsRunning = row.is_running;
  let nextSecondsLeft;
  let nextEndsAtMs = null;

  if (row.is_running && row.ends_at) {
    nextEndsAtMs = new Date(row.ends_at).getTime();
    nextSecondsLeft = Math.max(0, Math.ceil((nextEndsAtMs - Date.now()) / 1000));
  } else {
    nextSecondsLeft = Math.max(0, row.remaining_seconds);
  }

  return {
    action: "apply",
    patch: {
      mode: nextMode,
      sessions: nextSessions,
      pendingMode: nextPendingMode,
      isRunning: nextIsRunning,
      secondsLeft: nextSecondsLeft,
      endsAtMs: nextEndsAtMs,
      latestRef: {
        mode: nextMode,
        sessions: nextSessions,
        isRunning: nextIsRunning,
        secondsLeft: nextSecondsLeft,
        pendingMode: nextPendingMode,
      },
    },
  };
}
