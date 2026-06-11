import {
  DEFAULT_DURATIONS,
  DURATION_KEY,
  AUTO_TRANSITION_KEY,
  SYNC_SESSION_KEY,
} from "./constants.js";

export function readPendingSyncSessionId() {
  try {
    const raw = localStorage.getItem(SYNC_SESSION_KEY);
    if (!raw) return null;
    const { sessionId } = JSON.parse(raw);
    return sessionId || null;
  } catch {
    return null;
  }
}

export function loadAutoTransition() {
  try {
    const raw = localStorage.getItem(AUTO_TRANSITION_KEY);
    if (raw === null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function saveAutoTransition(enabled) {
  try {
    localStorage.setItem(AUTO_TRANSITION_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function loadStoredDurations() {
  try {
    const raw = localStorage.getItem(DURATION_KEY);
    if (!raw) return { ...DEFAULT_DURATIONS };
    const parsed = JSON.parse(raw);
    return {
      work: Number.isFinite(parsed.work) && parsed.work > 0 ? parsed.work : DEFAULT_DURATIONS.work,
      shortBreak:
        Number.isFinite(parsed.shortBreak) && parsed.shortBreak > 0
          ? parsed.shortBreak
          : DEFAULT_DURATIONS.shortBreak,
      longBreak:
        Number.isFinite(parsed.longBreak) && parsed.longBreak > 0
          ? parsed.longBreak
          : DEFAULT_DURATIONS.longBreak,
    };
  } catch {
    return { ...DEFAULT_DURATIONS };
  }
}

export function saveStoredDurations(d) {
  try {
    localStorage.setItem(DURATION_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}
