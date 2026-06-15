// APNs Live Activity push helper. Loads an ES256 .p8 key from env on
// first use, caches the signed bearer token for 50 minutes (tokens are
// valid for 60 min server-side and reused tokens within that window are
// fine), and POSTs a Live Activity update or end payload to Apple.
//
// Env (set via `supabase secrets set …`):
//   APNS_KEY_P8     full PEM of the .p8 (including BEGIN/END lines)
//   APNS_KEY_ID     10-char Key ID
//   APNS_TEAM_ID    10-char Team ID
//   APNS_BUNDLE_ID  e.g. com.gmango.mangodoro
//   APNS_ENV        "production" | "sandbox"  (default production)

type CachedJWT = { token: string; expiresAt: number };

let cachedJWT: CachedJWT | null = null;
let cachedKey: CryptoKey | null = null;

function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function importP8(pem: string): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  cachedKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return cachedKey;
}

async function getBearer(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedJWT && cachedJWT.expiresAt > nowSec) return cachedJWT.token;

  const keyId = env("APNS_KEY_ID");
  const teamId = env("APNS_TEAM_ID");
  const pem = env("APNS_KEY_P8");
  const key = await importP8(pem);

  const header = base64UrlEncodeString(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64UrlEncodeString(JSON.stringify({ iss: teamId, iat: nowSec }));
  const signingInput = `${header}.${payload}`;
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    new TextEncoder().encode(signingInput),
  );
  const sig = base64UrlEncode(new Uint8Array(sigBuf));
  const token = `${signingInput}.${sig}`;
  cachedJWT = { token, expiresAt: nowSec + 50 * 60 };
  return token;
}

export type LiveActivityContentState = Record<string, unknown>;

export type SendLiveActivityPushArgs = {
  pushToken: string;
  event: "update" | "end";
  contentState: LiveActivityContentState;
  apnsEnv?: "production" | "sandbox";
  staleDate?: number; // unix seconds
  dismissalDate?: number; // unix seconds (for "end")
  priority?: 5 | 10;
};

export type SendLiveActivityPushResult = {
  ok: boolean;
  status: number;
  apnsId: string | null;
  body: string;
};

export async function sendLiveActivityPush(
  args: SendLiveActivityPushArgs,
): Promise<SendLiveActivityPushResult> {
  const bundleId = env("APNS_BUNDLE_ID");
  const defaultEnv = env("APNS_ENV", "production");
  const apnsEnv = args.apnsEnv ?? (defaultEnv as "production" | "sandbox");
  const host = apnsEnv === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const url = `https://${host}/3/device/${args.pushToken}`;

  const nowSec = Math.floor(Date.now() / 1000);
  const aps: Record<string, unknown> = {
    timestamp: nowSec,
    event: args.event,
    "content-state": args.contentState,
  };
  if (args.staleDate !== undefined) aps["stale-date"] = args.staleDate;
  if (args.event === "end") {
    aps["dismissal-date"] = args.dismissalDate ?? nowSec;
  }

  const bearer = await getBearer();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `bearer ${bearer}`,
      "apns-topic": `${bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": String(args.priority ?? 10),
      "apns-expiration": "0",
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps }),
  });
  const body = await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    apnsId: resp.headers.get("apns-id"),
    body,
  };
}
