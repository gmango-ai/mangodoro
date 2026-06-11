const SYNC_SESSION_KEY = "ql_sync_session";

export function notifySessionJoined(session) {
  localStorage.setItem(SYNC_SESSION_KEY, JSON.stringify({ sessionId: session.id }));
  window.dispatchEvent(
    new CustomEvent("ql-sync-session-joined", { detail: { session } })
  );
  try {
    new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" });
  } catch {
    /* ignore */
  }
}

export function notifySessionCleared() {
  localStorage.removeItem(SYNC_SESSION_KEY);
  try {
    new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" });
  } catch {
    /* ignore */
  }
}
