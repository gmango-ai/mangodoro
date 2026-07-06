import { useEffect, useState } from "react";

// Physical device rotation (0 | 90 | 180 | 270) from the accelerometer, for
// counter-rotating the local self-view. The app is orientation-locked to
// portrait, but iOS still rotates the CAMERA capture with the device — so
// turning the phone makes your own video sideways/upside-down. We read gravity
// and hand back the angle so the tile can rotate the <video> back upright.
//
// iOS 13+ gates motion events behind a permission that needs a user gesture,
// so this only activates when `enabled` (the opt-in toggle) flips true; the
// caller wires that to a tap. Returns 0 whenever motion is unavailable/denied,
// which leaves the video exactly as it is today.
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
    let last = 0;

    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const q = quadrantFromGravity(g.x, g.y);
      if (q == null || q === last) return;
      last = q;
      setAngle(q);
    };

    const attach = () => {
      if (cancelled) return;
      window.addEventListener("devicemotion", onMotion);
    };

    const req = window.DeviceMotionEvent.requestPermission;
    if (typeof req === "function") {
      // iOS: must be called from a user gesture; `enabled` flipping true is
      // driven by a tap, so this resolves. Denied → stay at 0 (no rotation).
      req().then((state) => { if (state === "granted") attach(); }).catch(() => {});
    } else {
      attach();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return enabled ? angle : 0;
}
