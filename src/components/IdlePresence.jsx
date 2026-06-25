import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";

// Automatic online/away presence from tab activity.
//
// While you're interacting with a tab you read as "active" (online); after a
// stretch of no interaction (or the tab hidden) you auto-flip to "away", and
// you flip back the moment you return. Activity + the auto-away flag live in
// localStorage so multiple tabs coordinate (active in any tab = active) and a
// closed tab can't strand you as "away".
//
// Only auto-manages the ambient states — a deliberate status (heads-down, in a
// meeting, out to lunch, commuting) is never overridden by idle.
const IDLE_MS = 5 * 60 * 1000;   // no interaction this long → away
const CHECK_MS = 30 * 1000;
const ACT_KEY = "mango:lastActivity";
const AWAY_KEY = "mango:autoAway"; // JSON { prev } while we hold an auto-away
const AUTO_FROM = new Set(["active", "available"]);

const now = () => Date.now();
const getNum = (k, d) => { try { const v = localStorage.getItem(k); return v ? Number(v) : d; } catch { return d; } };
const setStr = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
const getJSON = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const del = (k) => { try { localStorage.removeItem(k); } catch { /* */ } };

export default function IdlePresence() {
  const { settings, session, updateStatus } = useApp();
  const { syncSession, setStatus: setSyncStatus } = useSyncSession();

  const ref = useRef({});
  ref.current = {
    userId: session?.user?.id,
    presence: settings?.presenceState || "active",
    syncSession, setSyncStatus, updateStatus,
  };

  // Record interaction (shared across tabs, throttled).
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

  // Idle → away, return → restore.
  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const apply = async (state) => {
      const s = ref.current;
      try {
        await s.updateStatus?.({ presenceState: state });
        if (s.syncSession && s.setSyncStatus) await s.setSyncStatus({ presenceState: state });
      } catch { /* best-effort */ }
    };
    const tick = async () => {
      const s = ref.current;
      if (!s.userId) return;
      const idle = now() - getNum(ACT_KEY, now()) >= IDLE_MS;
      const flag = getJSON(AWAY_KEY);
      if (idle) {
        if (!flag && AUTO_FROM.has(s.presence)) {
          setStr(AWAY_KEY, JSON.stringify({ prev: s.presence }));
          await apply("away");
        }
      } else if (flag) {
        del(AWAY_KEY);
        // Only undo our own auto-away — if they've since set a real status, leave it.
        if (s.presence === "away" || AUTO_FROM.has(s.presence)) await apply(flag.prev || "active");
      }
    };
    tick();
    const id = setInterval(tick, CHECK_MS);
    return () => clearInterval(id);
  }, [session?.user?.id]);

  return null;
}
