import { UPDATED_AT_SKEW_MS } from "./constants.js";
import { remoteRemainingSeconds, remoteUpdatedAtMs, rowsConflict } from "./derive.js";

export { remoteRemainingSeconds };

/**
 * Pure evaluation of whether a remote row should be applied, conflicted, or skipped.
 * Returns { action: "skip" | "conflict" | "apply", patch? }
 */
export function evaluateRemoteRow({
  row,
  force = false,
  local,
  durations,
  localEndsAtMs,
  lastLocalWriteAtMs,
  suppressUntilMs,
  canControl,
}) {
  if (!row || Date.now() < suppressUntilMs) {
    return { action: "skip" };
  }

  const remoteUpdatedMs = remoteUpdatedAtMs(row);
  const lastWriteMs = lastLocalWriteAtMs;

  if (
    !force &&
    remoteUpdatedMs != null &&
    lastWriteMs != null &&
    remoteUpdatedMs < lastWriteMs - UPDATED_AT_SKEW_MS
  ) {
    return { action: "skip" };
  }

  const isSelfEcho =
    remoteUpdatedMs != null &&
    lastWriteMs != null &&
    Math.abs(remoteUpdatedMs - lastWriteMs) <= UPDATED_AT_SKEW_MS;

  if (
    !force &&
    !isSelfEcho &&
    canControl &&
    remoteUpdatedMs != null &&
    lastWriteMs != null &&
    remoteUpdatedMs > lastWriteMs + UPDATED_AT_SKEW_MS &&
    rowsConflict(local, row, durations, localEndsAtMs)
  ) {
    return { action: "conflict", row };
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
