// Connection rate-limiting for LiveKit, shared by every <LiveKitRoom> we mount.
//
// Why this exists: a failed or churning connection used to spam the backend.
// LiveKit Cloud rate-limits connection *attempts* per project; when it 429s, the
// client's DefaultReconnectPolicy retries through every region with tiny delays,
// and StrictMode double-mounts + Vite HMR remounts pile fresh connects on top.
// The result is a wall of `429 Too Many Requests` and wasted token-mint calls.
//
// Two guards:
//   1. A custom reconnect policy with real exponential backoff + a hard cap, so
//      one failure can't turn into a cross-region flood.
//   2. A client-side throttle (connectDelayFor / markConnectAttempt) so we never
//      *initiate* a connection to the same room more than once per window —
//      absorbing StrictMode/HMR remounts and rapid rejoin loops.
//
// Both objects are module constants so passing them to <LiveKitRoom options=…>
// doesn't change identity between renders (which would recreate the Room).

// Capped exponential backoff. context.retryCount starts at 0 for the first
// retry. Return null to stop retrying — after ~6 tries (~30s of backoff) we give
// up rather than hammer. Active calls still get robust reconnection; this only
// stops the tight loop.
export const LK_RECONNECT_POLICY = {
  nextRetryDelayInMs(context) {
    if (context.retryCount >= 6) return null;
    const base = Math.min(8000, 600 * 2 ** context.retryCount);
    // Jitter so N clients reconnecting together don't sync into a thundering herd.
    return base + Math.random() * 400;
  },
};

// Stable RoomOptions carrying the policy. Pass this (not a fresh literal) to
// <LiveKitRoom options=…> so the Room isn't recreated on every render.
export const LK_ROOM_OPTIONS = {
  reconnectPolicy: LK_RECONNECT_POLICY,
};

// The initial join retries at most twice; on failure the app bounces back to the
// green room, which is a cleaner recovery than silently retrying forever.
export const LK_CONNECT_OPTIONS = {
  maxRetries: 2,
};

// Don't initiate a connection to the same room more often than this.
const MIN_CONNECT_INTERVAL = 2500;
const lastConnectAt = new Map();

// Milliseconds to wait before it's OK to (re)connect to this room. 0 = go now.
export function connectDelayFor(roomName) {
  const last = lastConnectAt.get(roomName) || 0;
  return Math.max(0, MIN_CONNECT_INTERVAL - (Date.now() - last));
}

// Record that we just kicked off a connection to this room.
export function markConnectAttempt(roomName) {
  lastConnectAt.set(roomName, Date.now());
}
