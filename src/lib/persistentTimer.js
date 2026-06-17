import { registerPlugin } from "@capacitor/core";
import { getPlatform, isElectron, isMobileApp } from "./platform";
import { supabase } from "../supabase";

// Single point of dispatch for the "show the live timer on a system
// surface" capability. Each platform has a different mechanism:
//   • iOS    → ActivityKit Live Activity (lockscreen + Dynamic Island)
//   • Android → ongoing notification with chronometer (lockscreen)
//   • Electron → tray (menu bar / system tray) with countdown title
// The activity persists across pause; only stop() actually ends it.

const IOSLiveActivity = registerPlugin("LiveActivity");
const AndroidPersistentTimer = registerPlugin("PersistentTimer");

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Reuse a single push-token listener for the lifetime of the JS context.
// Each time the iOS plugin's Activity.pushTokenUpdates yields a token —
// on initial registration AND on rotation — we forward it to our
// activity-register edge function so the server can target it with APNs
// Live Activity pushes when the user taps the lockscreen buttons.
let pushTokenListenerHandle = null;
let lastUploadedKey = null;
let lastActivityId = null;
let pendingStateSync = null;

function captureActivityId(result) {
  if (result?.activityId) lastActivityId = result.activityId;
}

function buildActivityState({
  endsAtMs,
  mode,
  label,
  isSynced,
  isRunning,
  pausedSecondsLeft,
  accentColorHex,
}) {
  const state = {
    endsAtEpochMs: endsAtMs,
    mode: mode || "work",
    label: label || "Pomodoro",
    isSynced: !!isSynced,
    isRunning: !!isRunning,
  };
  if (pausedSecondsLeft != null) {
    state.pausedSecondsLeft = Math.max(0, Math.round(pausedSecondsLeft));
  }
  if (accentColorHex) {
    state.accentColorHex = accentColorHex;
  }
  return state;
}

async function syncActivityState(state) {
  if (!state || typeof state.isRunning !== "boolean") return;
  if (!lastActivityId) {
    pendingStateSync = state;
    return;
  }
  try {
    const { error } = await supabase.functions.invoke("activity-register", {
      body: {
        activity_id: lastActivityId,
        state,
      },
    });
    if (error) {
      pendingStateSync = state;
      console.warn("[persistentTimer] activity-register state sync failed", error);
      return;
    }
    pendingStateSync = null;
  } catch (e) {
    pendingStateSync = state;
    console.warn("[persistentTimer] activity-register state sync threw", e);
  }
}

async function uploadPushToken({ activityId, pushToken, secretHash, apnsEnv, state }) {
  if (!activityId || !pushToken || !secretHash) return;
  lastActivityId = activityId;
  // De-dupe redundant rotations (same id+token).
  const key = `${activityId}:${pushToken}`;
  if (key === lastUploadedKey) {
    if (pendingStateSync) await syncActivityState(pendingStateSync);
    else if (state) await syncActivityState(state);
    return;
  }
  try {
    const body = {
      activity_id: activityId,
      push_token: pushToken,
      secret_hash: secretHash,
      apns_env: apnsEnv || "production",
    };
    if (state) body.state = state;
    const { error } = await supabase.functions.invoke("activity-register", { body });
    if (error) {
      console.warn("[persistentTimer] activity-register failed", error);
      return;
    }
    lastUploadedKey = key;
    if (pendingStateSync) {
      await syncActivityState(pendingStateSync);
    }
  } catch (e) {
    console.warn("[persistentTimer] activity-register threw", e);
  }
}

async function unregisterActivity(activityId) {
  if (!activityId) return;
  try {
    const { error } = await supabase.functions.invoke("activity-unregister", {
      body: { activity_id: activityId },
    });
    if (error) {
      console.warn("[persistentTimer] activity-unregister failed", error);
    }
  } catch (e) {
    console.warn("[persistentTimer] activity-unregister threw", e);
  }
}

async function ensurePushTokenListener() {
  if (pushTokenListenerHandle || getPlatform() !== "ios") return;
  try {
    pushTokenListenerHandle = await IOSLiveActivity.addListener(
      "pushTokenReceived",
      uploadPushToken
    );
  } catch (e) {
    console.warn("[persistentTimer] failed to attach pushToken listener", e);
  }
}

function modeLabel(mode) {
  if (mode === "work") return "Focus";
  if (mode === "shortBreak") return "Short break";
  if (mode === "longBreak") return "Long break";
  return "Pomodoro";
}

// Reads the user's currently-applied accent color from the document
// root. applyAccent() in src/lib/accent.js writes it as a CSS variable,
// so we just pick it up from the computed style. Returns a hex string
// or null.
function currentAccentHex() {
  if (typeof document === "undefined") return null;
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim();
    if (!raw) return null;
    // Accept "#rrggbb" directly; for other forms (rgb(), oklch(), etc.)
    // bail rather than feed garbage to the native parser — the activity
    // will fall back to its default tint.
    return raw.startsWith("#") ? raw : null;
  } catch {
    return null;
  }
}

export async function startPersistentTimer({ endsAtMs, mode, isSynced }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const platform = getPlatform();
  try {
    if (platform === "ios") {
      await ensurePushTokenListener();
      const result = await IOSLiveActivity.start({
        endsAtMs,
        mode,
        label,
        isSynced: !!isSynced,
        isRunning: true,
        accentColorHex,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
      });
      captureActivityId(result);
      await syncActivityState(
        buildActivityState({
          endsAtMs,
          mode,
          label,
          isSynced,
          isRunning: true,
          accentColorHex,
        })
      );
    } else if (platform === "android") {
      await AndroidPersistentTimer.start({
        endsAtMs,
        mode,
        label,
        isSynced: !!isSynced,
      });
    } else if (isElectron) {
      window.__electronTimer?.start({ endsAtMs, mode, label, isSynced: !!isSynced });
    }
  } catch (e) {
    console.warn("[persistentTimer] start failed", platform, e);
  }
}

// Used when the phase changes mid-run. Cheaper than stop+start because
// the surface stays visible without flicker.
export async function updatePersistentTimer({ endsAtMs, mode, isSynced }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const platform = getPlatform();
  try {
    if (platform === "ios") {
      await ensurePushTokenListener();
      const result = await IOSLiveActivity.update({
        endsAtMs,
        mode,
        label,
        isSynced: !!isSynced,
        isRunning: true,
        accentColorHex,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
      });
      captureActivityId(result);
      await syncActivityState(
        buildActivityState({
          endsAtMs,
          mode,
          label,
          isSynced,
          isRunning: true,
          accentColorHex,
        })
      );
    } else if (platform === "android") {
      await AndroidPersistentTimer.update({
        endsAtMs,
        mode,
        label,
        isSynced: !!isSynced,
      });
    } else if (isElectron) {
      window.__electronTimer?.update({ endsAtMs, mode, label, isSynced: !!isSynced });
    }
  } catch (e) {
    console.warn("[persistentTimer] update failed", platform, e);
  }
}

// Freezes the on-screen countdown to a static MM:SS without ending the
// surface. iOS-only for now — Android's ongoing notification still
// clears on pause until we add a foreground service; Electron's tray
// clears too.
export async function pausePersistentTimer({ pausedSecondsLeft, mode, isSynced }) {
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const platform = getPlatform();
  const pausedSec = Math.max(0, Math.round(pausedSecondsLeft || 0));
  try {
    if (platform === "ios") {
      const result = await IOSLiveActivity.pause({
        pausedSecondsLeft: pausedSec,
        mode,
        label,
        isSynced: !!isSynced,
        accentColorHex,
      });
      captureActivityId(result);
      await syncActivityState(
        buildActivityState({
          endsAtMs: Date.now(),
          mode,
          label,
          isSynced,
          isRunning: false,
          pausedSecondsLeft: pausedSec,
          accentColorHex,
        })
      );
    } else if (platform === "android") {
      await AndroidPersistentTimer.stop();
    } else if (isElectron) {
      window.__electronTimer?.stop();
    }
  } catch (e) {
    console.warn("[persistentTimer] pause failed", platform, e);
  }
}

// Resume from a paused state. Computes a fresh endsAtMs from the
// remaining seconds at the moment of resume so the widget's
// Text(timerInterval:) picks up exactly where it left off.
export async function resumePersistentTimer({ pausedSecondsLeft, mode, isSynced }) {
  const endsAtMs = Date.now() + Math.max(0, Math.round(pausedSecondsLeft || 0)) * 1000;
  await startPersistentTimer({ endsAtMs, mode, isSynced });
}

export async function stopPersistentTimer() {
  const platform = getPlatform();
  const activityId = lastActivityId;
  try {
    if (platform === "ios") {
      await IOSLiveActivity.stop();
      if (activityId) {
        await unregisterActivity(activityId);
      }
      lastActivityId = null;
      lastUploadedKey = null;
      pendingStateSync = null;
    } else if (platform === "android") {
      await AndroidPersistentTimer.stop();
    } else if (isElectron) {
      window.__electronTimer?.stop();
    }
  } catch (e) {
    console.warn("[persistentTimer] stop failed", platform, e);
  }
}

// Reads the App Group flag set by the widget's ToggleTimerIntent when
// the user tapped pause/resume from the lockscreen while the app was
// backgrounded. Resolves to { pending, nowRunning } so PomodoroContext
// can reconcile its state with what the lockscreen already shows. iOS
// only; everywhere else this is a no-op.
export async function consumePendingTimerToggle() {
  if (getPlatform() !== "ios")
    return { pending: false, nowRunning: false, pendingStop: false };
  try {
    return await IOSLiveActivity.consumePendingToggle();
  } catch (e) {
    console.warn("[persistentTimer] consumePendingToggle failed", e);
    return { pending: false, nowRunning: false, pendingStop: false };
  }
}

export const hasPersistentTimerSurface = isMobileApp || isElectron;
