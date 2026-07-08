// Mints a LiveKit access token using Web Crypto (no deps).
//
// LiveKit access tokens are plain JWTs signed HS256 with the API secret,
// carrying a `video` grant (VideoGrant) that scopes the participant to a
// room. See https://docs.livekit.io/home/get-started/authentication/
//
// We sign manually (rather than pull livekit-server-sdk into the edge
// runtime) to keep the function dependency-free.

export type LiveKitSignInput = {
  apiKey: string;       // LiveKit API key ("ID")
  apiSecret: string;    // LiveKit API secret
  identity: string;     // unique participant identity (we use the uid)
  name?: string;        // display name shown in the room
  room: string;         // room name the token is scoped to
  ttlSeconds?: number;  // default 6h
};

function b64url(bytes: Uint8Array | string): string {
  const u8 = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Standard base64 (with padding) — LiveKit's webhook sha256 claim uses this.
function b64std(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function importSigningKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { secret, key };
  return key;
}

export async function signLiveKitToken(input: LiveKitSignInput): Promise<{
  token: string;
  exp: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? 6 * 60 * 60);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    exp,
    iss: input.apiKey,
    nbf: now - 10,
    sub: input.identity,
    name: input.name ?? "",
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Lets the client set its own `role` attribute (publisher | spectator)
      // so others can render spectators as a name list instead of tiles.
      canUpdateOwnMetadata: true,
    },
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importSigningKey(input.apiSecret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return { token: `${signingInput}.${b64url(sig)}`, exp };
}

// Signs a short-lived ADMIN token (roomAdmin grant) for calling the LiveKit
// server API (RoomService: RemoveParticipant / MutePublishedTrack; Egress:
// StartRoomCompositeEgress / StopEgress). Never given to a browser — only used
// server-side. Not a join token: roomJoin is false, so it can't enter the room.
//
// Pass `record: true` to also grant `roomRecord` — LiveKit's Egress API rejects
// a token without it.
export async function signLiveKitAdminToken(input: {
  apiKey: string;
  apiSecret: string;
  room: string;
  ttlSeconds?: number;
  record?: boolean;
}): Promise<{ token: string; exp: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? 5 * 60);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    exp,
    iss: input.apiKey,
    nbf: now - 10,
    sub: "mangodoro-moderator",
    video: {
      room: input.room,
      roomAdmin: true,
      roomJoin: false,
      ...(input.record ? { roomRecord: true } : {}),
    },
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importSigningKey(input.apiSecret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return { token: `${signingInput}.${b64url(sig)}`, exp };
}

// Verifies a LiveKit webhook request. LiveKit signs the POST with an
// `Authorization` header carrying a JWT (HS256, signed with the API secret)
// whose `sha256` claim is the base64 SHA-256 of the raw request body. We
// re-sign the token's `header.payload` to check the signature, then recompute
// the body hash and compare it to the claim. Returns true only if both match.
export async function verifyLiveKitWebhook(
  rawBody: string,
  authHeader: string,
  apiSecret: string,
): Promise<boolean> {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  // 1. Signature valid (token really came from someone holding the secret)?
  const key = await importSigningKey(apiSecret);
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${headerB64}.${payloadB64}`)),
  );
  if (b64url(expectedSig) !== sigB64) return false;

  // 2. Does the body hash match the token's sha256 claim?
  let payload: { sha256?: string };
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return false;
  }
  if (!payload.sha256) return false;
  const bodyHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)),
  );
  return b64std(bodyHash) === payload.sha256;
}
