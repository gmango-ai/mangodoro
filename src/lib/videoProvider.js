// Video provider selection for the Jitsi ↔ LiveKit A/B test.
//
// A call is multiplayer: everyone in a room MUST land on the same
// provider or they won't see each other. So assignment is keyed on the
// ROOM, not the user — every participant entering room X hashes to the
// same provider. The split is deterministic (no DB column, stable across
// reloads, and a single org experiences both providers across its
// different rooms — a clean within-org comparison).
//
// Graceful degrade: until LiveKit is actually configured
// (VITE_LIVE_KIT_URL set), every room resolves to Jitsi, so shipping
// this code before provisioning LiveKit Cloud changes nothing.
//
// Manual override (for testing LiveKit on a specific device, e.g. mobile):
//   • URL param  ?video=livekit  or  ?video=jitsi
//   • env        VITE_VIDEO_FORCE=livekit
// An override always wins over the hash.

export const VIDEO = { JITSI: "jitsi", LIVEKIT: "livekit" };

export const LIVEKIT_URL = import.meta.env.VITE_LIVE_KIT_URL || "";
export const LIVEKIT_CONFIGURED = Boolean(LIVEKIT_URL);

const FORCE = (import.meta.env.VITE_VIDEO_FORCE || "").toLowerCase();
// Bump the salt to re-randomize the room→provider mapping for a fresh
// experiment cohort.
const SALT = "mangodoro-video-ab-v1";

// FNV-1a 32-bit — small, stable, dependency-free string hash. We only
// need an even spread into two buckets, not crypto strength.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function urlOverride() {
  try {
    const v = new URLSearchParams(window.location.search).get("video");
    return v ? v.toLowerCase() : "";
  } catch {
    return "";
  }
}

// Resolve the provider a given room's call should use.
export function resolveVideoProvider(roomId) {
  const override = urlOverride() || FORCE;
  if (override === VIDEO.JITSI) return VIDEO.JITSI;
  if (override === VIDEO.LIVEKIT) {
    return LIVEKIT_CONFIGURED ? VIDEO.LIVEKIT : VIDEO.JITSI;
  }
  // No override → the actual A/B. Only route to LiveKit once it's wired.
  if (!LIVEKIT_CONFIGURED || !roomId) return VIDEO.JITSI;
  return fnv1a(`${SALT}:${roomId}`) % 2 === 0 ? VIDEO.JITSI : VIDEO.LIVEKIT;
}
