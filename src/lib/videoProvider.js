// Video provider selection.
//
// LiveKit is the standard provider for every room. Jitsi remains only as a
// graceful fallback when LiveKit isn't configured (no VITE_LIVE_KIT_URL), plus
// a manual `?video=jitsi` escape hatch for debugging.
//
// (Previously this hashed each room into a deterministic Jitsi↔LiveKit A/B
// split. That experiment is retired — LiveKit won.)
//
// Manual override:
//   • URL param  ?video=livekit  or  ?video=jitsi
//   • env        VITE_VIDEO_FORCE=livekit | jitsi

export const VIDEO = { JITSI: "jitsi", LIVEKIT: "livekit" };

export const LIVEKIT_URL = import.meta.env.VITE_LIVE_KIT_URL || "";
export const LIVEKIT_CONFIGURED = Boolean(LIVEKIT_URL);

const FORCE = (import.meta.env.VITE_VIDEO_FORCE || "").toLowerCase();

function urlOverride() {
  try {
    const v = new URLSearchParams(window.location.search).get("video");
    return v ? v.toLowerCase() : "";
  } catch {
    return "";
  }
}

// Resolve the provider a room's call should use. The roomId arg is retained for
// call-site compatibility but no longer affects the result.
export function resolveVideoProvider() {
  const override = urlOverride() || FORCE;
  if (override === VIDEO.JITSI) return VIDEO.JITSI;
  if (override === VIDEO.LIVEKIT) return LIVEKIT_CONFIGURED ? VIDEO.LIVEKIT : VIDEO.JITSI;
  // Default: LiveKit everywhere it's configured; Jitsi only as a fallback.
  return LIVEKIT_CONFIGURED ? VIDEO.LIVEKIT : VIDEO.JITSI;
}
