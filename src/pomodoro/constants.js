export const DEFAULT_DURATIONS = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

export const DURATION_KEY = "ql_pomodoro_durations";
export const AUTO_TRANSITION_KEY = "ql_pomodoro_auto_transition";
export const SYNC_SESSION_KEY = "ql_sync_session";
export const TRANSITION_SECONDS = 5;
export const WORK_SESSIONS_PER_CYCLE = 4;

export const UPDATED_AT_SKEW_MS = 100;

export const MODE_LABELS = {
  work: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

export function defaultBreakForStreak(completedCount) {
  return completedCount > 0 && completedCount % WORK_SESSIONS_PER_CYCLE === 0
    ? "longBreak"
    : "shortBreak";
}
