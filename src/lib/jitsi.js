// Video-call provider config.
//
// Two providers supported today:
//   * public — free meet.jit.si, no JWT, no AppID. The default.
//   * jaas   — 8x8 JaaS. Requires a tenant AppID + a signed JWT.
//
// Provider is decided at module load time based on env vars:
//   VITE_JITSI_APP_ID    — your JaaS AppID ("vpaas-magic-cookie-…")
//   VITE_JITSI_DEV_JWT   — a JWT minted from the JaaS console
//                          ("Generate JWT" → ~2hr lifespan). Dev /
//                          testing only. Production should swap to
//                          a Supabase Edge Function that mints per
//                          user / per session.
//
// If both env vars are present we run against JaaS. Either missing
// → public meet.jit.si. That way the dev gets a one-line opt-in and
// production builds without JaaS creds still work unchanged.

const APP_ID = import.meta.env.VITE_JITSI_APP_ID || "";
const DEV_JWT = import.meta.env.VITE_JITSI_DEV_JWT || "";
const HAS_JAAS = Boolean(APP_ID && DEV_JWT);

export const VIDEO_PROVIDER = HAS_JAAS ? "jaas" : "public";
export const JITSI_DOMAIN = HAS_JAAS ? "8x8.vc" : "meet.jit.si";

// Per-app namespace for room names. On public meet.jit.si, just a
// prefix so no one guesses our rooms by accident; on JaaS, the AppID
// is REQUIRED as the first path segment and the rest is the room
// name within our tenant.
export const ROOM_PREFIX = "mangodoro-";

export function roomNameForRoom(roomId) {
  if (!roomId) return "";
  const local = `${ROOM_PREFIX}${roomId}`;
  return HAS_JAAS ? `${APP_ID}/${local}` : local;
}

// Returns the JWT to attach to the embed, or null when running
// against meet.jit.si (which doesn't accept a JWT). For the dev
// path we hand back the static token from VITE_JITSI_DEV_JWT; the
// production path will replace this with a fetch() against a
// Supabase Edge Function that mints per-user JWTs.
export async function fetchVideoCallToken(/* roomName, userId */) {
  if (!HAS_JAAS) return null;
  return DEV_JWT;
}

// Lazily load the JitsiMeetExternalAPI script. Returns the global
// constructor once the script has loaded; subsequent calls return
// instantly. We don't bundle Jitsi's API into our build so the
// version always matches what the provider domain serves.
//
// JaaS quirk: the script must be loaded from the *tenant-prefixed*
// URL `https://8x8.vc/<AppID>/external_api.js`. The bare-domain
// URL serves a generic script that connects to the wrong signaling
// endpoint — media bootstraps fine but the conference join silently
// never completes. Public meet.jit.si uses the bare path.
let scriptLoadPromise = null;
export function loadJitsiExternalApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);
  if (scriptLoadPromise) return scriptLoadPromise;
  const path = HAS_JAAS ? `${APP_ID}/external_api.js` : "external_api.js";
  const scriptUrl = `https://${JITSI_DOMAIN}/${path}`;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = scriptUrl;
    s.async = true;
    s.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error("external_api.js loaded but constructor missing"));
    };
    s.onerror = () => reject(new Error(`Failed to load Jitsi external_api.js from ${scriptUrl}`));
    document.head.appendChild(s);
  });
  return scriptLoadPromise;
}

// One-time dev log so we can tell at a glance which provider the
// browser session is using. Helpful when debugging "why does the
// embed look different?" — common answer: env var typo / restart.
if (typeof window !== "undefined" && !window.__mangodoroJitsiLogged) {
  window.__mangodoroJitsiLogged = true;
  // eslint-disable-next-line no-console
  console.info(`[jitsi] provider=${VIDEO_PROVIDER}  domain=${JITSI_DOMAIN}${HAS_JAAS ? ` appId=${APP_ID}` : ""}`);
}
