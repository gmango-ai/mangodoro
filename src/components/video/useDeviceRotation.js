import { useEffect, useState } from "react";

// Rotation (0 | 90 | 180 | 270) to apply to the local self-view so it stays
// upright as you turn the phone. The app is portrait-locked, but iOS rotates
// the CAMERA capture with the device, so a turned phone makes your own video
// sideways/upside-down. We read gravity and hand back the counter-rotation.
//
// Robustness notes (this is easy to get subtly wrong):
//  • iOS 13+ gates motion behind a permission that MUST be requested from a
//    user gesture (and needs NSMotionUsageDescription in Info.plist) — asking
//    from an effect is silently denied. We request from the first touch.
//  • The sign/units of accelerationIncludingGravity differ across platforms.
//    So we DON'T assume "upright = y negative"; instead we capture the gravity
//    direction at startup (the phone is portrait then) as the reference and
//    measure the CHANGE from it. That makes 180° (the common "upside-down"
//    case) correct regardless of the platform's sign convention.
export function useDeviceRotation(enabled) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.DeviceMotionEvent) return undefined;
    let cancelled = false;
    let listening = false;
    let refDeg = null; // gravity direction at startup (portrait-upright)
    let last = 0;
    setAngle(0);

    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const planar = Math.hypot(g.x, g.y);
      const total = Math.hypot(g.x, g.y, g.z || 0);
      // Too flat (gravity mostly along z) to read a screen rotation — ratio, so
      // it's unit-agnostic (works whether values are ~1G or ~9.8 m/s²).
      if (total > 0 && planar / total < 0.5) return;
      const deg = (Math.atan2(g.x, g.y) * 180) / Math.PI;
      if (refDeg == null) { refDeg = deg; return; } // establish upright reference
      // Signed change from upright, normalized to (-180, 180], quantized to a
      // quadrant; negated so the video rotates OPPOSITE the device turn.
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
      // iOS 13+: request from the first touch (a real user gesture). The grant
      // persists, so later calls resolve without a dialog.
      onGesture = () => {
        window.removeEventListener("pointerdown", onGesture, true);
        req().then((state) => { if (state === "granted") startListening(); }).catch(() => {});
      };
      window.addEventListener("pointerdown", onGesture, true);
    } else {
      // Android / older iOS — no permission gate.
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
