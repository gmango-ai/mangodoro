// Per-room connection diagnostics for LiveKit, to chase down "force disconnects"
// (a member silently bounced back to the green room).
//
// The DisconnectReason alone rarely explains it: "signal_close" / "join_failure"
// could be a flaky network OR the server dropping the session, and a clean
// "duplicate_identity" looks identical in the UI to a network drop. What
// disambiguates them is the LEAD-UP — the sequence of reconnecting / quality /
// visibility / online events in the seconds before the drop.
//
// So we keep a bounded, timestamped ring buffer of those events per room. It's
// silent on its own (nothing is logged until something interesting happens); the
// disconnect handler dumps the whole timeline at once via diagReport(), turning a
// bare reason code into a readable story:
//   "connected 47s, quality went good→poor→lost, 2 reconnecting attempts,
//    navigator.onLine=false at drop" → that member's network died, not a kick.

// Keep the last N events per room. Enough to span a reconnect storm without
// growing unbounded on a long, churny call.
const MAX_EVENTS = 50;

// roomName -> { startedAt, events: [{ t, type, detail }], reconnects, lastQuality }
const logs = new Map();

function bufFor(roomName) {
  let b = logs.get(roomName);
  if (!b) {
    b = { startedAt: 0, events: [], reconnects: 0, lastQuality: "unknown" };
    logs.set(roomName, b);
  }
  return b;
}

// (Re)start the buffer — call on every (re)connect so durations and the timeline
// are measured from the most recent join, not a stale earlier one.
export function diagReset(roomName) {
  const b = bufFor(roomName);
  b.startedAt = Date.now();
  b.events = [];
  b.reconnects = 0;
  b.lastQuality = "unknown";
}

// Append a timestamped event (t = ms since the buffer started). `detail` is any
// small JSON-able context (a quality string, an error message, an env snapshot).
export function diagRecord(roomName, type, detail) {
  const b = bufFor(roomName);
  const t = b.startedAt ? Date.now() - b.startedAt : 0;
  b.events.push({ t, type, ...(detail !== undefined ? { detail } : {}) });
  if (b.events.length > MAX_EVENTS) b.events.shift();
  if (type === "reconnecting") b.reconnects += 1;
  if (type === "quality" && detail?.quality) b.lastQuality = detail.quality;
  return b;
}

// Cheap, high-signal environment snapshot — the stuff that separates a local
// network / tab problem from a server-side kick. Network Information API
// (downlink/effectiveType/rtt) is Chromium-only; null elsewhere, which is fine.
export function diagEnv() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  return {
    online: typeof nav.onLine === "boolean" ? nav.onLine : null,
    visibility: typeof document !== "undefined" ? document.visibilityState : null,
    downlink: conn?.downlink ?? null,
    effectiveType: conn?.effectiveType ?? null,
    rtt: conn?.rtt ?? null,
  };
}

// App-level call lifecycle breadcrumb — distinct from the LiveKit-engine events
// above. This traces WHY a call object starts / ends / changes (a user leave vs.
// a sync-session room change vs. carry-over into a new room), which is the OTHER
// way a member gets "force disconnected": the call is torn down or re-keyed out
// from under a perfectly healthy LiveKit connection, with no DisconnectReason to
// show for it. Prefixed `[call]` so it reads alongside the `[livekit]` lines.
export function logCallEvent(event, detail) {
  try {
    console.info(`[call] ${event}`, detail ?? "");
  } catch {
    /* console unavailable — ignore */
  }
}

// Build the full disconnect report: the reason + how long we lasted + the
// lead-up timeline + the environment at drop time. Returned (not logged) so the
// caller decides verbosity and can forward it to analytics.
export function diagReport(roomName, reasonName, reasonCode) {
  const b = bufFor(roomName);
  const durationMs = b.startedAt ? Date.now() - b.startedAt : 0;
  return {
    room: roomName,
    reason: reasonName,
    reasonCode: reasonCode ?? null,
    durationMs,
    durationS: Math.round(durationMs / 1000),
    reconnects: b.reconnects,
    lastQuality: b.lastQuality,
    env: diagEnv(),
    timeline: b.events.slice(),
  };
}
