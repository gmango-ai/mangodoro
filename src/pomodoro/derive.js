export function remoteRemainingSeconds(row) {
  if (row.is_running && row.ends_at) {
    return Math.max(0, Math.ceil((new Date(row.ends_at).getTime() - Date.now()) / 1000));
  }
  return Math.max(0, row.remaining_seconds ?? 0);
}

export function remoteUpdatedAtMs(row) {
  if (!row?.updated_at) return null;
  const ms = new Date(row.updated_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function hasTimerProgress({ mode, durations, secondsLeft, isRunning }) {
  if (isRunning) return true;
  return secondsLeft < durations[mode];
}

export function rowsConflict(local, remoteRow, durations, localEndsAtMs) {
  if ((local.pendingMode ?? null) !== (remoteRow.pending_mode ?? null)) return true;

  if (
    !hasTimerProgress({
      mode: local.mode,
      durations,
      secondsLeft: local.secondsLeft,
      isRunning: local.isRunning,
    }) &&
    !local.pendingMode
  ) {
    return false;
  }

  const localRemaining =
    local.isRunning && localEndsAtMs
      ? Math.max(0, Math.ceil((localEndsAtMs - Date.now()) / 1000))
      : local.secondsLeft;
  const remoteRemaining = remoteRemainingSeconds(remoteRow);

  if (remoteRow.mode !== local.mode) return true;
  if (remoteRow.is_running !== local.isRunning) return true;
  if (Math.abs(remoteRemaining - localRemaining) > 3) return true;
  return false;
}

export function deriveDisplay(row, now = Date.now(), durations) {
  if (!row) return null;
  const mode = row.mode;
  const sessions = row.sessions ?? 0;
  const pendingMode = row.pending_mode ?? null;
  const isRunning = row.is_running;
  let secondsLeft;
  let endsAtMs = null;

  if (row.is_running && row.ends_at) {
    endsAtMs = new Date(row.ends_at).getTime();
    secondsLeft = Math.max(0, Math.ceil((endsAtMs - now) / 1000));
  } else {
    secondsLeft = Math.max(0, row.remaining_seconds ?? 0);
  }

  const displayMode = pendingMode ?? mode;
  const total = pendingMode ? 5 : durations?.[mode] ?? 0;

  return {
    mode,
    sessions,
    pendingMode,
    isRunning,
    secondsLeft,
    endsAtMs,
    displayMode,
    total,
  };
}
