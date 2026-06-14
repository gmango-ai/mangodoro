import { LocalNotifications } from "@capacitor/local-notifications";
import { isMobileApp } from "./platform";

// All scheduling for the pomodoro alarm shares one ID so a new schedule
// call replaces any prior one — the user only ever has one pomodoro
// running at a time.
const POMODORO_NOTIF_ID = 1;

export async function requestNotificationPermissions() {
  if (!isMobileApp) return null;
  try {
    return await LocalNotifications.requestPermissions();
  } catch (e) {
    console.warn("[notif] requestPermissions failed", e);
    return null;
  }
}

// Schedule the alarm that fires when the current pomodoro phase ends.
// The OS holds the timer even after the WebView is suspended — this is
// the whole reason native local notifications exist for us. Re-calling
// with the same ID replaces the previous schedule, so we don't have to
// cancel first when phase-changing.
export async function schedulePomodoroNotification({ endsAtMs, mode, isSynced }) {
  if (!isMobileApp) return;
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const { title, body } = pomodoroText({ mode, isSynced });
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: POMODORO_NOTIF_ID,
          title,
          body,
          schedule: { at: new Date(endsAtMs), allowWhileIdle: true },
        },
      ],
    });
  } catch (e) {
    console.warn("[notif] schedule failed", e);
  }
}

export async function cancelPomodoroNotification() {
  if (!isMobileApp) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: POMODORO_NOTIF_ID }] });
  } catch {
    // No-op — cancel is idempotent; the plugin throws on Android if
    // nothing's pending, which we don't care about.
  }
}

// mode is the phase that's ENDING, not the next phase.
function pomodoroText({ mode, isSynced }) {
  if (mode === "work") {
    return {
      title: "Pomodoro done",
      body: isSynced ? "Sync session: time for a break." : "Time for a break.",
    };
  }
  return {
    title: "Break over",
    body: isSynced ? "Sync session: back to focus." : "Back to focus.",
  };
}
