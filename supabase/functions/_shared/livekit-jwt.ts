// Mints a LiveKit access token using Web Crypto (no deps).
//
// LiveKit access tokens are plain JWTs signed HS256 with the API secret,
// carrying a `video` grant (VideoGrant) that scopes the participant to a
// room. See https://docs.livekit.io/home/get-started/authentication/
//
// We sign manually (rather than pull livekit-server-sdk into the edge
// runtime) to match the dependency-free pattern in jaas-jwt.ts.

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
// server API (RoomService: RemoveParticipant / MutePublishedTrack). Never given
// to a browser — only used server-side in the moderation edge function. Not a
// join token: roomJoin is false, so it can't be used to enter the room.
export async function signLiveKitAdminToken(input: {
  apiKey: string;
  apiSecret: string;
  room: string;
  ttlSeconds?: number;
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
