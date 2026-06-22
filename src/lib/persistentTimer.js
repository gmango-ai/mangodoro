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

// Device-level registration (separate from the per-Live-Activity push token):
// the APNs device token (silent home-widget refresh), the push-to-start token
// (server-created Live Activities), and the per-user widget secret hash (auth
// for the home-widget Start button). Registered once per session; re-uploaded
// when a token arrives async.
let deviceTokenListenerHandle = null;
let pushToStartTokenListenerHandle = null;
let lastUploadedDeviceKey = null;
let deviceRegUserId = null;

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
  breakColorHex,
  phaseDurationSeconds,
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
  // Break-phase color + current phase length drive the Airy widget ring and
  // its per-phase accent. Optional — the widget falls back to the accent and
  // per-mode default durations when absent.
  if (breakColorHex) {
    state.breakColorHex = breakColorHex;
  }
  if (phaseDurationSeconds != null && phaseDurationSeconds > 0) {
    state.phaseDurationSeconds = Math.round(phaseDurationSeconds);
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
  return cssVarHex("--color-accent");
}

// The break-phase color (analogous to the accent), used by the Airy widget
// ring/accent during shortBreak/longBreak. Same source/strategy as the accent.
function currentBreakHex() {
  return cssVarHex("--color-break");
}

// Reads a CSS custom property off the document root and returns it only if
// it's a plain "#rrggbb" hex — for other forms (rgb(), oklch(), etc.) bail
// rather than feed garbage to the native parser (it falls back to its tint).
function cssVarHex(name) {
  if (typeof document === "undefined") return null;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return null;
    return raw.startsWith("#") ? raw : null;
  } catch {
    return null;
  }
}

export async function startPersistentTimer({ endsAtMs, mode, isSynced, durationSeconds }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const breakColorHex = currentBreakHex();
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
        breakColorHex,
        phaseDurationSeconds: durationSeconds,
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
          breakColorHex,
          phaseDurationSeconds: durationSeconds,
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
export async function updatePersistentTimer({ endsAtMs, mode, isSynced, durationSeconds }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const breakColorHex = currentBreakHex();
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
        breakColorHex,
        phaseDurationSeconds: durationSeconds,
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
          breakColorHex,
          phaseDurationSeconds: durationSeconds,
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
export async function pausePersistentTimer({ pausedSecondsLeft, mode, isSynced, durationSeconds }) {
  const label = modeLabel(mode);
  const accentColorHex = currentAccentHex();
  const breakColorHex = currentBreakHex();
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
        breakColorHex,
        phaseDurationSeconds: durationSeconds,
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
          breakColorHex,
          phaseDurationSeconds: durationSeconds,
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
export async function resumePersistentTimer({ pausedSecondsLeft, mode, isSynced, durationSeconds }) {
  const endsAtMs = Date.now() + Math.max(0, Math.round(pausedSecondsLeft || 0)) * 1000;
  await startPersistentTimer({ endsAtMs, mode, isSynced, durationSeconds });
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

// Upload whatever device-level registration fields are currently available
// (tokens arrive async, so this may be partial — device-register merges).
async function uploadDeviceRegistration(reg) {
  if (!reg?.deviceId) return;
  const body = { device_id: reg.deviceId, apns_env: reg.apnsEnv || "production" };
  if (reg.pushToken) body.push_token = reg.pushToken;
  if (reg.ptsToken) body.pts_token = reg.ptsToken;
  if (reg.secretHash) body.widget_secret_hash = reg.secretHash;
  const key = JSON.stringify(body);
  if (key === lastUploadedDeviceKey) return;
  try {
    const { error } = await supabase.functions.invoke("device-register", { body });
    if (error) {
      console.warn("[persistentTimer] device-register failed", error);
      return;
    }
    lastUploadedDeviceKey = key;
  } catch (e) {
    console.warn("[persistentTimer] device-register threw", e);
  }
}

// Pull the current registration snapshot from native (ensures the per-user
// widget secret exists + stores the user id in the App Group) and upload it.
async function registerDevice() {
  try {
    const reg = await IOSLiveActivity.getWidgetRegistration(
      deviceRegUserId ? { userId: deviceRegUserId } : {}
    );
    await uploadDeviceRegistration(reg);
  } catch (e) {
    console.warn("[persistentTimer] getWidgetRegistration failed", e);
  }
}

// Registers this device for: silent home-widget refresh pushes, push-to-start
// Live Activities, and the home-widget Start button (per-user widget secret).
// Safe to call on every app start once authenticated (no-op off iOS). Re-uploads
// when the APNs / push-to-start tokens arrive async.
export async function initDeviceWidgetPush(userId) {
  if (getPlatform() !== "ios") return;
  if (userId) deviceRegUserId = userId;
  try {
    if (!deviceTokenListenerHandle) {
      deviceTokenListenerHandle = await IOSLiveActivity.addListener(
        "deviceTokenReceived",
        () => { registerDevice(); }
      );
    }
    if (!pushToStartTokenListenerHandle) {
      pushToStartTokenListenerHandle = await IOSLiveActivity.addListener(
        "pushToStartTokenReceived",
        () => { registerDevice(); }
      );
    }
    await registerDevice();
  } catch (e) {
    console.warn("[persistentTimer] initDeviceWidgetPush failed", e);
  }
}

export const hasPersistentTimerSurface = isMobileApp || isElectron;
