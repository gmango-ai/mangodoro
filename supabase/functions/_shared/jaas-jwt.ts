// Mints a JaaS JWT using Web Crypto (no deps).
//
// Mirrors scripts/jaas-mint.mjs but signs in Deno instead of Node.
// The header/payload shape is identical so we can swap one for the
// other without 8x8 noticing.
//
// Spec: https://developer.8x8.com/jaas/docs/api-keys-jwt

export type JaasUser = {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
  moderator?: boolean;
};

export type JaasFeatures = Partial<{
  livestreaming: boolean;
  "file-upload": boolean;
  "outbound-call": boolean;
  "sip-outbound-call": boolean;
  transcription: boolean;
  "list-visitors": boolean;
  recording: boolean;
  flip: boolean;
}>;

export type JaasSignInput = {
  appId: string;            // tenant AppID (vpaas-magic-cookie-…)
  kid: string;              // full kid (AppID/ShortKeyID)
  privateKeyPem: string;    // PKCS#8 PEM string
  user: JaasUser;
  room?: string;            // "*" for any room in the tenant (default)
  ttlSeconds?: number;      // default 2h
  features?: JaasFeatures;
};

const DEFAULT_FEATURES: JaasFeatures = {
  livestreaming: true,
  "file-upload": true,
  "outbound-call": false,
  "sip-outbound-call": false,
  transcription: true,
  "list-visitors": false,
  recording: true,
  flip: false,
};

function b64url(bytes: Uint8Array | string): string {
  const u8 =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: { pem: string; key: CryptoKey } | null = null;

async function importSigningKey(pem: string): Promise<CryptoKey> {
  // Cache the imported key across calls — importKey is cheap but
  // we burn ~5ms per request without it.
  if (cachedKey && cachedKey.pem === pem) return cachedKey.key;
  const der = pemToPkcs8(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { pem, key };
  return key;
}

export async function signJaasJwt(input: JaasSignInput): Promise<{
  jwt: string;
  exp: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? 2 * 60 * 60);

  const header = { alg: "RS256", typ: "JWT", kid: input.kid };
  const payload = {
    aud: "jitsi",
    iss: "chat",
    iat: now,
    exp,
    nbf: now - 10,
    sub: input.appId,
    room: input.room ?? "*",
    context: {
      features: { ...DEFAULT_FEATURES, ...(input.features ?? {}) },
      user: {
        "hidden-from-recorder": false,
        moderator: input.user.moderator ?? true,
        name: input.user.name ?? "",
        id: input.user.id,
        avatar: input.user.avatar ?? "",
        email: input.user.email ?? "",
      },
    },
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importSigningKey(input.privateKeyPem);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return { jwt: `${signingInput}.${b64url(sig)}`, exp };
}
