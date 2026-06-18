// Video-call provider config.
//
// Two providers supported today:
//   * public — free meet.jit.si, no JWT, no AppID. The default.
//   * jaas   — 8x8 JaaS. Requires a tenant AppID + a signed JWT.
//
// Provider is decided at module load time based on env vars:
//   VITE_JITSI_APP_ID    — your JaaS AppID ("vpaas-magic-cookie-…")
//   VITE_JITSI_DEV_JWT   — optional static fallback JWT (~2h lifespan,
//                          minted via scripts/jaas-mint.mjs). Used
//                          only when the Supabase edge function path
//                          fails — local dev backstop.
//
// Auth path at runtime: the client calls the `mint-jaas-jwt` Supabase
// edge function with its session token; the function signs a JWT
// against the team's stored JaaS private key (Supabase secret) and
// returns it. So shipping JaaS no longer requires VITE_JITSI_DEV_JWT
// in Vercel — only VITE_JITSI_APP_ID.

import { supabase } from "../supabase";

const APP_ID = import.meta.env.VITE_JITSI_APP_ID || "";
const DEV_JWT = import.meta.env.VITE_JITSI_DEV_JWT || "";
const HAS_JAAS = Boolean(APP_ID);

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
// against meet.jit.si (which doesn't accept a JWT).
//
// Calls the `mint-jaas-jwt` Supabase edge function with the user's
// session, which signs against the JaaS private key stored as a
// Supabase secret. JWTs are cached per-tab for ~95% of their TTL so
// re-entering a room within the cache window doesn't re-mint.
//
// Local-dev backstop: if VITE_JITSI_DEV_JWT is set AND the edge
// function call fails, we fall back to the static token. Useful when
// running before the edge function is deployed or when offline.
let _tokenCache = null; // { jwt, expiresAtMs }

async function mintFromEdgeFunction({ displayName, room } = {}) {
  const { data, error } = await supabase.functions.invoke("mint-jaas-jwt", {
    body: {
      display_name: displayName || "",
      room: room || "*",
    },
  });
  if (error) throw error;
  if (!data?.jwt) throw new Error("mint-jaas-jwt returned no jwt");
  // exp is unix seconds; refresh when 5% of TTL remains.
  const expMs = (data.exp || (Math.floor(Date.now() / 1000) + 60 * 60)) * 1000;
  const ttlMs = Math.max(0, expMs - Date.now());
  const refreshAtMs = Date.now() + Math.floor(ttlMs * 0.95);
  return { jwt: data.jwt, expiresAtMs: refreshAtMs };
}

export async function fetchVideoCallToken(roomName, _userId, displayName) {
  if (!HAS_JAAS) return null;
  if (_tokenCache && _tokenCache.expiresAtMs > Date.now()) {
    return _tokenCache.jwt;
  }
  try {
    _tokenCache = await mintFromEdgeFunction({ displayName });
    return _tokenCache.jwt;
  } catch (e) {
    if (DEV_JWT) {
      // eslint-disable-next-line no-console
      console.warn("[jitsi] mint-jaas-jwt failed; using VITE_JITSI_DEV_JWT", e);
      return DEV_JWT;
    }
    throw e;
  }
}

export function clearVideoCallTokenCache() {
  _tokenCache = null;
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
