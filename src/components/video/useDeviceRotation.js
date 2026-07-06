import { useEffect, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { isMobileApp } from "../../lib/platform";

// Rotation (0 | 90 | 180 | 270) to apply to the local self-view so it stays
// upright as you turn the phone. The app is portrait-locked, but iOS rotates
// the CAMERA capture with the device, so a turned phone makes your own video
// sideways/upside-down.
//
// Native iOS is the ONLY reliable source here: WKWebView does not deliver the
// web DeviceMotion/DeviceOrientation events (no requestPermission, no prompt,
// silent nothing). So on the Capacitor app we read UIDevice's physical
// orientation via the LiveActivity plugin (permission-free, works while the UI
// is orientation-locked). The web DeviceMotion path is kept only as a
// best-effort fallback for the browser/installed PWA.
const LiveActivity = isMobileApp ? registerPlugin("LiveActivity") : null;

export function useDeviceRotation(enabled) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    setAngle(0);

    // ── Native iOS: UIDevice orientation ──────────────────────────────────
    if (LiveActivity) {
      let cancelled = false;
      let handle = null;
      (async () => {
        try {
          handle = await LiveActivity.addListener("deviceOrientation", ({ angle: a }) => {
            if (!cancelled && typeof a === "number") setAngle((((a % 360) + 360) % 360));
          });
          await LiveActivity.startOrientation();
        } catch { /* plugin without orientation (older build) — no rotation */ }
      })();
      return () => {
        cancelled = true;
        handle?.remove?.();
        LiveActivity.stopOrientation?.().catch?.(() => {});
      };
    }

    // ── Web fallback (browser / PWA): DeviceMotion, calibrated ────────────
    if (typeof window === "undefined" || !window.DeviceMotionEvent) return undefined;
    let cancelled = false;
    let listening = false;
    let refDeg = null;
    let last = 0;

    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const planar = Math.hypot(g.x, g.y);
      const total = Math.hypot(g.x, g.y, g.z || 0);
      if (total > 0 && planar / total < 0.5) return; // too flat to tell
      const deg = (Math.atan2(g.x, g.y) * 180) / Math.PI;
      if (refDeg == null) { refDeg = deg; return; }
      let d = deg - refDeg;
      d = ((((d + 180) % 360) + 360) % 360) - 180;
      const q = (((-Math.round(d / 90) * 90) % 360) + 360) % 360;
      if (q === last) return;
      last = q;
      setAngle(q);
    };

    const startListening = () => {
      if (listening || cancelled) return;
      listening = true;
      window.addEventListener("devicemotion", onMotion);
    };

    const req = window.DeviceMotionEvent.requestPermission;
    let onGesture = null;
    if (typeof req === "function") {
      onGesture = () => {
        window.removeEventListener("pointerdown", onGesture, true);
        req().then((state) => { if (state === "granted") startListening(); }).catch(() => {});
      };
      window.addEventListener("pointerdown", onGesture, true);
    } else {
      startListening();
    }
    return () => {
      cancelled = true;
      if (onGesture) window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return enabled ? angle : 0;
}
