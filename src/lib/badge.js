// macOS dock / installed-PWA badge wrapper around the App Badge API.
// Falls back silently on platforms that don't support it (Safari, Firefox).
//
// True macOS menu bar (tray) integration requires a native shell — out of
// scope for this PWA. Badge API is the closest standards-track option:
// on Chrome/Edge installed PWAs on macOS, the dock icon shows a numeric
// or empty badge.

export function setBadge(value) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  try {
    if (value == null || value === 0) {
      navigator.clearAppBadge?.();
      return;
    }
    const n = typeof value === "number" ? value : parseInt(value, 10);
    navigator.setAppBadge(Number.isFinite(n) && n > 0 ? n : 1).catch(() => {});
  } catch { /* ignore */ }
}

export function clearBadge() {
  if (typeof navigator === "undefined") return;
  navigator.clearAppBadge?.().catch?.(() => {});
}

// Format MM:SS for use in window/tab titles.
export function formatTimerTitle(secondsLeft, mode) {
  if (secondsLeft == null) return null;
  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");
  const label = mode === "shortBreak" || mode === "longBreak" ? "break" : "focus";
  return `${m}:${s} · ${label}`;
}
