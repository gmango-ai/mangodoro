// Video provider config.
//
// LiveKit is the only provider. (Jitsi was retired — the previous A/B split and
// the graceful fallback have both been removed.)

export const LIVEKIT_URL = import.meta.env.VITE_LIVE_KIT_URL || "";
export const LIVEKIT_CONFIGURED = Boolean(LIVEKIT_URL);
