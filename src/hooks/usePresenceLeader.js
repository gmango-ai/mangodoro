import { useEffect, useState } from "react";

// Tab-leader election so only ONE tab per browser owns the presence write +
// heartbeat (instead of every open tab redundantly writing user_presence).
//
// Uses the Web Locks API: whoever holds the "mango:presence-writer" exclusive
// lock is the leader; the lock is held for the tab's lifetime and released
// automatically when the tab closes/crashes, at which point a waiting tab
// acquires it and becomes the new leader. Where Web Locks is unavailable, every
// tab acts as leader — same (redundant-write) behavior as before, never worse.
const LOCK = "mango:presence-writer";

export function usePresenceLeader() {
  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) {
      setIsLeader(true); // fallback: no election available
      return undefined;
    }
    let active = true;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    // request() resolves when the lock is GRANTED; the callback holds it until
    // `held` resolves (on unmount). If the tab never wins, the callback just
    // never runs until another leader releases.
    locks
      .request(LOCK, { mode: "exclusive" }, async () => {
        if (active) setIsLeader(true);
        await held;
      })
      .catch(() => { /* aborted / unsupported */ });

    return () => {
      active = false;
      setIsLeader(false);
      release?.(); // drop the lock so another tab can lead
    };
  }, []);

  return isLeader;
}
