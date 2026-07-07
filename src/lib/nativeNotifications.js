import { LocalNotifications } from "@capacitor/local-notifications";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isMobileApp, getPlatform } from "./platform";
import {
  initDeviceWidgetPush,
  requestNativeNotificationPermission,
  getNativeNotificationPermission,
} from "./persistentTimer";
import { blobToBase64 } from "./utils";
import { USER_SOUND_PREFIX, TEAM_SOUND_PREFIX } from "./pomodoroSound";

// ── Native remote ALERT push (the "notify me when the app is closed" path) ──
// Web Push can't run inside the Capacitor WKWebView, so the native app relies
// on APNs alert pushes from the native-push edge function instead. Enabling it
// = grant iOS notification permission + ensure the device's APNs token is
// registered (device-register → device_push_tokens.push_token, which
// native-push targets). See ios/App/App/PersistentTimerPlugin.swift.

// True where native alert push is available. iOS only for now (Android would
// use FCM, not wired). NOT the web PWA — that uses webPush.js.
export function nativePushSupported() {
  return isMobileApp && getPlatform() === "ios";
}

// "granted" | "denied" | "prompt" | "unsupported" — reflects the current iOS
// notification authorization so the Settings toggle can render its state.
export async function getNativePushStatus() {
  if (!nativePushSupported()) return "unsupported";
  const { status } = await getNativeNotificationPermission();
  return status || "prompt";
}

// Request iOS notification authorization and register this device's APNs token
// so native-push can reach it. Returns { granted, error }. iOS won't re-prompt
// once decided — a prior "denied" resolves granted:false, and the caller should
// point the user at iOS Settings.
export async function enableNativePush(userId) {
  if (!nativePushSupported()) return { granted: false, error: "Not supported on this device." };
  try {
    const { granted } = await requestNativeNotificationPermission();
    if (granted) {
      // Make sure the APNs device token is uploaded (idempotent; also runs on
      // app boot). Without a registered token native-push has nothing to hit.
      await initDeviceWidgetPush(userId);
      return { granted: true, error: null };
    }
    return {
      granted: false,
      error: "Notifications are turned off. Enable them in iOS Settings › Mangodoro › Notifications.",
    };
  } catch (e) {
    return { granted: false, error: e?.message || "Couldn't enable notifications." };
  }
}

// All scheduling for the pomodoro alarm shares one ID so a new schedule
// call replaces any prior one — the user only ever has one pomodoro
// running at a time.
const POMODORO_NOTIF_ID = 1;

// Subdirectory inside the iOS Library/ container that the OS searches
// for notification-sound files. Files must end up at:
//   <App>/Library/Sounds/<filename>
// and the schedule call references them by bare filename (no path).
const IOS_SOUND_DIR = "Sounds";

export async function requestNotificationPermissions() {
  if (!isMobileApp) return null;
  try {
    // The default request asks for alert + badge + sound on iOS. We
    // call it explicitly here on launch so the OS prompt appears at a
    // sensible moment instead of mid-pomodoro.
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
//
// presetId / userSounds / teamSounds let us resolve the user's chosen
// alarm into something the OS can actually play: a cached filename
// from Library/Sounds (custom uploads on iOS) or the literal string
// "default" (built-in synth presets, or any case where the custom
// file isn't usable). Without an explicit sound the iOS notification
// is silent — that was the original bug.
export async function schedulePomodoroNotification({
  endsAtMs,
  mode,
  isSynced,
  presetId,
  userSounds = [],
  teamSounds = [],
}) {
  if (!isMobileApp) return;
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const { title, body } = pomodoroText({ mode, isSynced });
  const sound = await resolveNotificationSound({ presetId, userSounds, teamSounds });
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: POMODORO_NOTIF_ID,
          title,
          body,
          sound,
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

// Remove the on-disk copy of a custom sound from Library/Sounds. Call
// when the user deletes their upload from the library, otherwise the
// MP3 leaks until app uninstall. Safe to invoke on non-iOS / web —
// no-op there. presetId uses the same format as elsewhere
// (usound:<id> / tsound:<id>).
export async function clearCachedNotificationSound(presetId) {
  if (!isMobileApp || getPlatform() !== "ios") return;
  const filename = cachedSoundFilename.get(presetId);
  cachedSoundFilename.delete(presetId);
  if (!filename) return;
  try {
    await Filesystem.deleteFile({
      path: `${IOS_SOUND_DIR}/${filename}`,
      directory: Directory.Library,
    });
  } catch {
    // Already gone — fine. The plugin throws on missing file; we
    // don't care since the intent (no on-disk copy) is satisfied.
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

// Resolve the user's selected preset into a sound value the
// LocalNotifications plugin understands. Returns:
//   - a bare filename (e.g. "usound-abc.mp3") when the file is cached
//     in iOS Library/Sounds and the OS can find it
//   - the literal "default" otherwise — iOS plays its standard
//     notification sound, Android the channel's default. Anything is
//     better than silence.
async function resolveNotificationSound({ presetId, userSounds, teamSounds }) {
  if (!presetId) return "default";
  // Android can only reference sound files bundled into res/raw at
  // build time, so per-user custom alarms can't be wired here — fall
  // back to the channel default and let the in-app sound carry it
  // when the WebView is alive.
  if (getPlatform() !== "ios") return "default";

  const custom = lookupCustomSound(presetId, userSounds, teamSounds);
  if (!custom?.url) return "default";

  const filename = await ensureCachedCustomSound(presetId, custom.url);
  return filename || "default";
}

function lookupCustomSound(presetId, userSounds, teamSounds) {
  if (presetId.startsWith(USER_SOUND_PREFIX)) {
    const id = presetId.slice(USER_SOUND_PREFIX.length);
    return userSounds.find((s) => s.id === id) || null;
  }
  if (presetId.startsWith(TEAM_SOUND_PREFIX)) {
    const id = presetId.slice(TEAM_SOUND_PREFIX.length);
    return teamSounds.find((s) => s.id === id) || null;
  }
  return null;
}

// In-memory cache: presetId → cached filename. Prevents re-downloading
// the same MP3 every time the pomodoro restarts. Cache is intentionally
// per-session — iOS keeps the file on disk anyway via Filesystem, and
// re-establishing the in-memory map on app launch is a cheap stat call.
const cachedSoundFilename = new Map();

async function ensureCachedCustomSound(presetId, url) {
  if (cachedSoundFilename.has(presetId)) return cachedSoundFilename.get(presetId);

  const ext = extensionFromUrl(url) || "mp3";
  const safeKey = presetId.replace(/[^a-z0-9]/gi, "_");
  const filename = `pomodoro-${safeKey}.${ext}`;
  const path = `${IOS_SOUND_DIR}/${filename}`;

  // Check whether we already have it from a prior session — Filesystem
  // persists across launches, our Map doesn't.
  try {
    await Filesystem.stat({ path, directory: Directory.Library });
    cachedSoundFilename.set(presetId, filename);
    return filename;
  } catch {
    // Not cached yet — fall through to download.
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Library,
      recursive: true,
    });
    cachedSoundFilename.set(presetId, filename);
    return filename;
  } catch (e) {
    console.warn("[notif] failed to cache sound", presetId, e);
    return null;
  }
}

function extensionFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

