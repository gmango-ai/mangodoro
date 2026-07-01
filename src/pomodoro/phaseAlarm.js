export const ALARM_CLAIM_LS_KEY = "ql_pomodoro_alarm_claim";
export const ALARM_CLAIM_TTL_MS = 5000;

/** Stable key for deduping a single phase-end alarm across tabs/windows. */
export function phaseAlarmKey(phaseFingerprint, event) {
  return `${phaseFingerprint}-${event}`;
}

/**
 * Derive which end-of-phase sound to play from a mode transition.
 *
 * `prevPending` is the pendingMode BEFORE this transition. It exists to kill a
 * double-alert: a synced focus→break runs in two steps — work ends (an auto-
 * transition is announced: pendingMode set) and then ~5s later that pending
 * RESOLVES into the break. Both steps leave "work", so without prevPending we'd
 * ring the "time for a break" chime twice (once at focus-end, once at break-
 * start). When the pending was already announced, the end was already signalled,
 * so the resolve step stays silent. (break→work is single by construction — its
 * announce step returns null since mode is still a break there.)
 *
 * @returns {"work"|"break"|null}
 */
export function derivePhaseEndEvent(prevMode, mode, pending, prevPending = null) {
  if (prevMode === "work") {
    // The end was already announced when the pending was set — don't ring again
    // when it resolves into the break.
    if (prevPending) return null;
    if (mode !== "work" || pending) return "work";
    return null;
  }
  if (
    (prevMode === "shortBreak" || prevMode === "longBreak")
    && mode === "work"
    && !pending
  ) {
    return "break";
  }
  return null;
}

/**
 * Cross-window dedup via shared localStorage. Returns true if this surface
 * should play (first claim within TTL wins).
 */
export function tryClaimPhaseAlarm(alarmKey) {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(ALARM_CLAIM_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.key === alarmKey && now - (parsed.ts || 0) < ALARM_CLAIM_TTL_MS) {
        return false;
      }
    }
    localStorage.setItem(
      ALARM_CLAIM_LS_KEY,
      JSON.stringify({ key: alarmKey, ts: now }),
    );
    return true;
  } catch {
    return true;
  }
}
