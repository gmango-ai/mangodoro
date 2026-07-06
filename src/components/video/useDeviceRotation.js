import { useEffect, useState } from "react";

// Physical device rotation (0 | 90 | 180 | 270) from the accelerometer, for
// counter-rotating the local self-view. The app is orientation-locked to
// portrait, but iOS still rotates the CAMERA capture with the device — so
// turning the phone makes your own video sideways/upside-down. We read gravity
// and hand back the angle so the tile can rotate the <video> back upright.
//
// iOS 13+ gates motion events behind a permission that MUST be requested from a
// user gesture — calling requestPermission() inside an effect is silently
// rejected. So we arm a one-shot capture-phase pointerdown listener and request
// permission from that first touch, then start reading motion. Returns 0 until
// motion is available/granted, which leaves the video exactly as it is today.
function quadrantFromGravity(x, y) {
  // Gravity points "down" in device space. Portrait upright ≈ (0, -9.8).
  // Only trust it when clearly tilted into an axis (avoids flip-flop when flat).
  if (Math.abs(x) < 4 && Math.abs(y) < 4) return null; // lying flat — keep last
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 0 : 180; // upright vs upside-down
  return x > 0 ? 90 : 270; // landscape left vs right
}

export function useDeviceRotation(enabled) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.DeviceMotionEvent) return undefined;
    let cancelled = false;
    let listening = false;
    let last = 0;
    setAngle(last);

    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const q = quadrantFromGravity(g.x, g.y);
      if (q == null || q === last) return;
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
      // iOS 13+: request from the first touch (a real user gesture). Once
      // granted the grant persists, so later calls resolve without a dialog.
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
