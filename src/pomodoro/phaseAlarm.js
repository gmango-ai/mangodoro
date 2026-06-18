export const ALARM_CLAIM_LS_KEY = "ql_pomodoro_alarm_claim";
export const ALARM_CLAIM_TTL_MS = 5000;

/** Stable key for deduping a single phase-end alarm across tabs/windows. */
export function phaseAlarmKey(phaseFingerprint, event) {
  return `${phaseFingerprint}-${event}`;
}

/**
 * Derive which end-of-phase sound to play from a mode transition.
 * @returns {"work"|"break"|null}
 */
export function derivePhaseEndEvent(prevMode, mode, pending) {
  if (prevMode === "work" && (mode !== "work" || pending)) {
    return "work";
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
