// Status resolver — the heart of seam ① (see
// docs/plans/status-notification-integration.md §3).
//
// A PURE function: given a snapshot of every signal we can read about a user,
// collapse it into ONE ResolvedStatus. No imports beyond the shared vocabulary,
// no I/O — so it's trivially testable, and the same logic can run client-side
// today and (coarsely) server-side later.
//
// Guiding rules:
//   • Availability DERIVES from environment (reliable); activity is confirmed
//     manually — we never guess intent.
//   • A manual override always wins, until it expires (even offline: a "back at
//     3" note must survive a closed tab).
//   • Idle is an OVERLAY whose stickiness scales with how deliberate the derived
//     state is: a meeting never idles to Away; derived focus idles away only
//     after a long stretch; ambient "available" idles at the short threshold.
//   • In a general room the room imposes nothing — status falls through a
//     predictable per-person ladder (no per-room "vibe" knob).

import { availabilityLight, legacyToAvailability } from "./presence";

// Idle thresholds. Ambient matches the existing IdlePresence (5m); derived deep
// work gets a longer leash because reading/thinking looks identical to idle.
export const AMBIENT_IDLE_MS = 5 * 60 * 1000;
export const FOCUS_IDLE_MS = 18 * 60 * 1000;

/**
 * @typedef {Object} Signals
 * @property {number} [now]                epoch ms (default Date.now())
 * @property {boolean} [online]            realtime presence says a client is live
 * @property {number} [idleMs]             ms since last input activity
 * @property {{availability:string,message?:string,expiresAt?:number}} [override]
 * @property {{title?:string}} [calendar]  a busy event happening now (Phase 3)
 * @property {{id?:string,name?:string,kind?:string}} [room]  kind: general|meeting|private|focus|break|social
 * @property {boolean} [carBluetooth]      connected to the car (Phase 2, mobile)
 * @property {{clockedIn?:boolean,onBreak?:boolean,breakKind?:string,clockedOut?:boolean}} [clock]
 * @property {{running?:boolean,mode?:string}} [pomodoro]  mode: work|shortBreak|longBreak
 * @property {{name?:string,since?:number}} [pairingWith]   (Phase 2)
 * @property {{id?:string,with?:string}} [huddle]           1:1 direct call (Phase 2)
 * @property {{label?:string,link?:string,since?:number,private?:boolean,kind?:string}} [activity]
 * @property {string} [legacyPresenceState] bridge while old writers still exist
 * @property {number} [since]              truer start of the current availability
 */

/**
 * Collapse all signals into one ResolvedStatus.
 * @param {Signals} sig
 */
export function resolveStatus(sig = {}) {
  const now = sig.now ?? Date.now();
  const location = buildLocation(sig);
  const activity = buildActivity(sig);

  // 1) Manual override wins outright — ignored only once expired.
  const ov =
    sig.override && (!sig.override.expiresAt || sig.override.expiresAt > now)
      ? sig.override
      : null;
  if (ov) {
    return finalize({
      availability: ov.availability,
      source: "override",
      override: ov,
      location,
      activity,
      now,
      since: sig.since,
    });
  }

  // 2) Derive from environment (priority stack §3.2, #3..#10).
  const derived = deriveEnvironmental(sig);

  // 3) Idle overlay — conditional on what we derived.
  const availability = shouldIdleAway(derived, sig) ? "away" : derived;

  return finalize({
    availability,
    source: "derived",
    override: null,
    location,
    activity,
    now,
    since: sig.since,
  });
}

// The environmental priority stack — highest signal wins. Returns a bare
// availability string; idle + override are layered on by resolveStatus.
function deriveEnvironmental(sig) {
  const roomKind = sig.room?.kind;

  // #3 calendar meeting happening now (Phase 3)
  if (sig.calendar) return "in_meeting";
  // #4 meeting-mode room — kind='meeting' already exists today
  if (roomKind === "meeting") return "in_meeting";
  // #5 commuting (car Bluetooth; mobile)
  if (sig.carBluetooth) return "commuting";
  // #6 clock: lunch / other break / clocked-out
  if (sig.clock?.onBreak) return sig.clock.breakKind === "lunch" ? "lunch" : "away";
  if (sig.clock?.clockedOut) return "off";
  // #7 focus-mode room OR an active pomodoro work sprint
  if (roomKind === "focus" || (sig.pomodoro?.running && sig.pomodoro.mode === "work"))
    return "focusing";
  // break / social rooms bias toward chatty-available
  if (roomKind === "break" || roomKind === "social") return "available";

  // #8 general room / clocked in / at desk — the per-person ladder (Q3).
  if (sig.pairingWith || sig.huddle) return "pairing";
  // Honor a legacy *deliberate* busy state during transition; ambient legacy
  // states fall through so idle can manage them.
  if (sig.legacyPresenceState) {
    const mapped = legacyToAvailability(sig.legacyPresenceState);
    if (mapped === "focusing" || mapped === "in_meeting") return mapped;
    if (mapped === "lunch" || mapped === "commuting") return mapped;
  }
  if (sig.room || sig.clock?.clockedIn || sig.online) return "available";

  // #10 nothing to go on
  return "offline";
}

// Idle stickiness scales with how deliberate the derived state is (Q2).
function shouldIdleAway(derived, sig) {
  const idleMs = sig.idleMs;
  if (idleMs == null) return false;
  switch (derived) {
    case "in_meeting":
      return false; // committed to being there — never idle away
    case "focusing":
    case "pairing":
      return idleMs >= FOCUS_IDLE_MS; // deep/collaborative work has quiet stretches
    case "available":
      return idleMs >= AMBIENT_IDLE_MS;
    default:
      return false; // lunch/commuting/off/offline are already grey
  }
}

function buildLocation(sig) {
  if (sig.room)
    return {
      kind: "room",
      roomId: sig.room.id,
      roomName: sig.room.name,
      roomKind: sig.room.kind,
    };
  if (sig.huddle) return { kind: "huddle", huddleId: sig.huddle.id, with: sig.huddle.with };
  return { kind: "none" };
}

// Activity passthrough. The `private` flag is preserved so the persistence
// layer can redact label/link BEFORE writing the shared row (RLS lets
// teammates read it, so redaction can't be client-render-only). Availability
// and duration are never hidden.
function buildActivity(sig) {
  if (sig.pairingWith) {
    return {
      kind: "pairing",
      label: sig.pairingWith.name ? `Pairing with ${sig.pairingWith.name}` : "Pairing",
      since: sig.pairingWith.since,
      private: false,
    };
  }
  if (sig.activity && (sig.activity.label || sig.activity.link)) {
    return {
      kind: sig.activity.kind || (sig.activity.link ? "task" : "manual"),
      label: sig.activity.label,
      link: sig.activity.link,
      since: sig.activity.since,
      private: !!sig.activity.private,
    };
  }
  return null;
}

function finalize({ availability, source, override, location, activity, now, since }) {
  return {
    availability,
    light: availabilityLight(availability),
    location,
    activity,
    source,
    override: override
      ? {
          availability: override.availability,
          message: override.message,
          expiresAt: override.expiresAt,
        }
      : null,
    since: since ?? now,
    resolvedAt: now,
  };
}
