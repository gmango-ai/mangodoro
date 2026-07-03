import { useEffect, useRef, useState } from "react";

// Latched "squished" flag for tiny call tiles (PiP, narrow office panels). Hard
// cutoffs at h=200/w=220 oscillate when ResizeObserver jitters around the
// boundary — enter low, exit high so the layout doesn't bounce.
export function useSquishedLayout(w, h) {
  const latchedRef = useRef(false);
  const [squished, setSquished] = useState(false);

  useEffect(() => {
    if (w <= 0 || h <= 0) return;
    const enter = h < 180 || w < 200;
    const exit = h >= 220 && w >= 240;
    if (!latchedRef.current && enter) latchedRef.current = true;
    else if (latchedRef.current && exit) latchedRef.current = false;
    setSquished(latchedRef.current);
  }, [w, h]);

  return squished;
}
