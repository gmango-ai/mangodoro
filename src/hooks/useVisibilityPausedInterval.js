import { useEffect, useRef } from "react";

// setInterval that stops while the tab is hidden, so backgrounded tabs do
// no DB/render work. On return to visible it fires once immediately
// (runOnVisible) to catch up, then resumes ticking. `fn` is kept in a ref
// so callers don't need to memoize it.
export function useVisibilityPausedInterval(fn, ms, { enabled = true, runOnVisible = true } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || !ms) return undefined;
    let id = null;
    const start = () => { if (id == null) id = setInterval(() => fnRef.current(), ms); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => {
      if (document.hidden) stop();
      else { if (runOnVisible) fnRef.current(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [ms, enabled, runOnVisible]);
}
