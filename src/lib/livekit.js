// LiveKit client config + access-token fetch.
//
// Mirrors the shape of jitsi.js: the client never holds the LiveKit API
// secret — it calls the `mint-livekit-token` Supabase edge function with
// its session, and that function signs a short-lived room-scoped token
// against the secret (a Supabase secret, never a VITE_ var).
//
// Env:
//   VITE_LIVE_KIT_URL  — wss://<project>.livekit.cloud (safe to expose)
// Server secrets (set via `supabase secrets set`):
//   LIVEKIT_API_KEY    — your LiveKit API key (the "ID")
//   LIVEKIT_API_SECRET — your LiveKit API secret

import { supabase } from "../supabase";
import { LIVEKIT_URL } from "./videoProvider";

export { LIVEKIT_URL };

// Per-room namespace so LiveKit room names don't collide with anything
// else in the same LiveKit project. Matches the Jitsi prefix for parity.
const ROOM_PREFIX = "mangodoro-";

export function liveKitRoomName(roomId) {
  if (!roomId) return "";
  return `${ROOM_PREFIX}${roomId}`;
}

// Tokens are cached per room name for ~90% of their TTL so re-entering a
// room within the window doesn't re-mint.
const _tokenCache = new Map(); // roomName -> { token, expiresAtMs }

export async function fetchLiveKitToken(roomName, displayName) {
  if (!roomName) throw new Error("LiveKit: missing room name");
  const cached = _tokenCache.get(roomName);
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;

  const { data, error } = await supabase.functions.invoke("mint-livekit-token", {
    body: { room: roomName, display_name: displayName || "" },
  });
  if (error) throw error;
  if (!data?.token) throw new Error("mint-livekit-token returned no token");

  const expMs = (data.exp || Math.floor(Date.now() / 1000) + 60 * 60) * 1000;
  const refreshAtMs = Date.now() + Math.floor(Math.max(0, expMs - Date.now()) * 0.9);
  _tokenCache.set(roomName, { token: data.token, expiresAtMs: refreshAtMs });
  return data.token;
}

export function clearLiveKitTokenCache() {
  _tokenCache.clear();
}
