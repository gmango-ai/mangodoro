import { useCallback, useEffect, useState } from "react";

// Native fullscreen (the Fullscreen API) for a passed element — takes over the
// whole physical screen, not just the browser window, which "maximize the
// window" can't do. Used by the member call (fullscreen the stage + controls)
// and the room kiosk (fullscreen the TV display). Tracks the ACTUAL fullscreen
// state via the fullscreenchange event so the button stays correct when the user
// exits with Esc or the browser drops out of fullscreen on its own. webkit*
// fallbacks cover Safari; where element fullscreen isn't supported at all (iOS
// Safari only fullscreens <video> elements), `supported` is false so the caller
// can hide the affordance.
export function useFullscreen(targetRef) {
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
      setIsFs(!!fsEl && fsEl === targetRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [targetRef]);
  const supported =
    typeof document !== "undefined" &&
    !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const toggle = useCallback(async () => {
    const el = targetRef.current;
    if (!el) return;
    try {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      /* denied / not allowed (e.g. not a user gesture, or sandboxed) — no-op */
    }
  }, [targetRef]);
  return { isFs, supported, toggle };
}
