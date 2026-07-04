import { useEffect } from "react";

// Activity tracker. Records the last interaction time to localStorage
// (mango:lastActivity), shared across tabs and throttled. The status resolver
// reads this timestamp as its idle signal and derives "away" — so this no
// longer writes any status itself (PresenceResolver owns status now).
const ACT_KEY = "mango:lastActivity";
const now = () => Date.now();
const setStr = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export default function IdlePresence() {
  useEffect(() => {
    let last = 0;
    const mark = () => { const n = now(); if (n - last > 5000) { last = n; setStr(ACT_KEY, String(n)); } };
    const onVisible = () => { if (!document.hidden) { last = 0; mark(); } };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    setStr(ACT_KEY, String(now()));
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
