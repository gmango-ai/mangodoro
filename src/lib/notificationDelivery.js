// Focus-aware delivery policy (plan §7.3) — PURE + testable.
//
// Given a notification's priority and the recipient's own live availability,
// decide how it should SURFACE: banner (in-app toast), sound, push (desktop /
// web-push), or hold (queue for a return-from-focus digest). The inbox row is
// ALWAYS recorded regardless — this only governs how loudly it arrives.
//
// The server makes the durable push/hold decision at emit time (it can't rely on
// a client being present); the client re-applies this on receipt as the
// last-mile authority for the in-app banner + sound, using its freshest status.

// 7-state vocabulary: focusing + meeting are do-not-disturb (red light);
// lunch/commuting/away/offline are away; online (or unknown) is free.
const DND = new Set(["focusing", "meeting"]);
const AWAY = new Set(["away", "lunch", "commuting", "offline"]);

export function availabilityBucket(availability) {
  if (DND.has(availability)) return "dnd";
  if (AWAY.has(availability)) return "away";
  return "free"; // online or unknown → reachable
}

export const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };

// @returns {{ banner: boolean, sound: boolean, push: boolean, hold: boolean }}
export function deliveryAction(priority = "normal", availability = "available") {
  const bucket = availabilityBucket(availability);
  const p = PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;

  // Urgent always breaks through, everywhere.
  if (p >= PRIORITY_RANK.urgent) return { banner: true, sound: true, push: true, hold: false };

  // Free / reachable → deliver in full.
  if (bucket === "free") return { banner: true, sound: true, push: true, hold: false };

  if (bucket === "dnd") {
    // High shows silently; low/normal are held for the return digest.
    if (p >= PRIORITY_RANK.high) return { banner: true, sound: false, push: false, hold: false };
    return { banner: false, sound: false, push: false, hold: true };
  }

  // away: high still reaches them (they may be on another device); low/normal → inbox only.
  if (p >= PRIORITY_RANK.high) return { banner: true, sound: false, push: true, hold: false };
  return { banner: false, sound: false, push: false, hold: true };
}
