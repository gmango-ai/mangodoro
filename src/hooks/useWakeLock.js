import { useEffect } from "react";

// Best-effort screen wake lock while `active` — the OS silently releases it
// when the tab hides, so re-request on return to visible. No-ops where the
// Screen Wake Lock API is unavailable (older WebViews); callers must treat
// staying awake as nice-to-have, not guaranteed.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock?.request) return undefined;
    let lock = null;
    let disposed = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (disposed) lock.release().catch(() => {});
      } catch {
        // Denied (low battery, browser policy) — nothing to do.
      }
    };
    acquire();
    const onVis = () => { if (!document.hidden) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, [active]);
}
