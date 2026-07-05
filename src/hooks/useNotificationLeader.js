import { useEffect, useRef } from "react";

// Elect ONE "leader" tab among all tabs of this browser, so exactly one tab
// fires OS notifications (multi-tab dedup — see notificationSurfaces).
//
// Mechanism: the Web Locks API. A tab requests an exclusive lock and holds it
// for its lifetime by never resolving the callback's promise — holding the lock
// IS being the leader. Other tabs' requests queue. When the leader tab closes or
// navigates away, the browser auto-releases the lock and the next queued tab is
// granted it, becoming the new leader instantly. No heartbeats, no elections, no
// storage — the browser arbitrates.
//
// Returns a ref (read `.current`), not state, so a memoized handler can check
// leadership at call time without re-subscribing or re-rendering on handoff.
//
// Fallback: browsers without Web Locks (older Safari) get `true` — we never
// SUPPRESS notifications when we can't coordinate; at worst duplicates reappear
// there, which is strictly safer than dropping a notification.
export function useNotificationLeader() {
  const isLeaderRef = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      isLeaderRef.current = true;
      return undefined;
    }

    const controller = new AbortController();
    let release = null;

    navigator.locks
      .request(
        "mango-notif-leader",
        { mode: "exclusive", signal: controller.signal },
        () =>
          new Promise((resolve) => {
            // Granted → we're the leader. Hold the lock until cleanup resolves this.
            isLeaderRef.current = true;
            release = resolve;
          })
      )
      .catch(() => {
        // AbortError (cleanup before grant) or an unsupported/failed request —
        // either way this tab isn't the leader.
      });

    return () => {
      isLeaderRef.current = false;
      controller.abort(); // cancels the request if it's still queued (not yet leader)
      if (release) release(); // releases the held lock if we were the leader → hands off
    };
  }, []);

  return isLeaderRef;
}
