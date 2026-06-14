import { registerPlugin } from "@capacitor/core";
import { getPlatform, isElectron, isMobileApp } from "./platform";

// Single point of dispatch for the "show the live timer on a system
// surface" capability. Each platform has a different mechanism:
//   • iOS    → ActivityKit Live Activity (lockscreen + Dynamic Island)
//   • Android → ongoing notification with chronometer (lockscreen)
//   • Electron → tray (menu bar / system tray) with countdown title
// All three self-tick once started, so this module only fires on phase
// boundaries (start / phase-change / pause / reset / cancel), not every
// second.

// Custom Capacitor plugins implemented natively in the Capacitor app.
// On web/electron these registerPlugin calls return a stub object whose
// method calls reject; we gate on platform before calling, so the stubs
// are never reached.
const IOSLiveActivity = registerPlugin("LiveActivity");
const AndroidPersistentTimer = registerPlugin("PersistentTimer");

function modeLabel(mode) {
  if (mode === "work") return "Focus";
  if (mode === "shortBreak") return "Short break";
  if (mode === "longBreak") return "Long break";
  return "Pomodoro";
}

export async function startPersistentTimer({ endsAtMs, mode, isSynced }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const platform = getPlatform();
  try {
    if (platform === "ios") {
      await IOSLiveActivity.start({ endsAtMs, mode, label, isSynced: !!isSynced });
    } else if (platform === "android") {
      await AndroidPersistentTimer.start({ endsAtMs, mode, label, isSynced: !!isSynced });
    } else if (isElectron) {
      window.__electronTimer?.start({ endsAtMs, mode, label, isSynced: !!isSynced });
    }
  } catch (e) {
    console.warn("[persistentTimer] start failed", platform, e);
  }
}

// Used when the phase changes mid-run (work → break, transition begins,
// duration adjusted, etc.). Cheaper than stop+start because the OS
// surface stays visible without flicker, especially the iOS Live
// Activity which has a noticeable dismiss animation.
export async function updatePersistentTimer({ endsAtMs, mode, isSynced }) {
  if (!endsAtMs || endsAtMs <= Date.now()) return;
  const label = modeLabel(mode);
  const platform = getPlatform();
  try {
    if (platform === "ios") {
      await IOSLiveActivity.update({ endsAtMs, mode, label, isSynced: !!isSynced });
    } else if (platform === "android") {
      await AndroidPersistentTimer.update({ endsAtMs, mode, label, isSynced: !!isSynced });
    } else if (isElectron) {
      window.__electronTimer?.update({ endsAtMs, mode, label, isSynced: !!isSynced });
    }
  } catch (e) {
    console.warn("[persistentTimer] update failed", platform, e);
  }
}

export async function stopPersistentTimer() {
  const platform = getPlatform();
  try {
    if (platform === "ios") {
      await IOSLiveActivity.stop();
    } else if (platform === "android") {
      await AndroidPersistentTimer.stop();
    } else if (isElectron) {
      window.__electronTimer?.stop();
    }
  } catch (e) {
    console.warn("[persistentTimer] stop failed", platform, e);
  }
}

// True when any of the three surfaces is reachable from this process.
// Web (non-Electron) and Capacitor on platforms without our custom
// plugins both return false.
export const hasPersistentTimerSurface = isMobileApp || isElectron;
