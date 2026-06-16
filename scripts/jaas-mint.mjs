#!/usr/bin/env node
// Local-dev JaaS JWT minter. Signs a JWT against your downloaded
// JaaS private key so the Jitsi embed can talk to your tenant
// without going through the JaaS console's SAMPLE_APP playground
// (which only signs with their demo key — never with yours).
//
// USAGE:
//   bun run scripts/jaas-mint.mjs
//
// Reads from .env:
//   VITE_JITSI_APP_ID          — your AppID (vpaas-magic-cookie-…)
//   JAAS_KID                   — full kid (AppID/ShortKeyID, e.g.
//                                vpaas-…/6373c6). Visible in JaaS
//                                Console → API Keys table.
//   JAAS_PRIVATE_KEY_PATH      — absolute or relative path to the
//                                .pk file you downloaded when you
//                                created the API key. Default:
//                                ./private-keys/jaas.pk
//
// Optionally override the embedded user identity (defaults to a
// generic local-dev user):
//   JAAS_USER_NAME   JAAS_USER_EMAIL   JAAS_USER_ID
//
// Output: prints the JWT to stdout. Copy it into .env as
// VITE_JITSI_DEV_JWT, restart Vite, refresh the browser.
//
// The JWT is valid for 2 hours; re-run when it expires. The Supabase
// Edge Function path is the long-term replacement.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSign } from "node:crypto";

const APP_ID = process.env.VITE_JITSI_APP_ID;
const KID = process.env.JAAS_KID || process.env.VITE_JAAS_KID;
const KEY_PATH = process.env.JAAS_PRIVATE_KEY_PATH || "./private-keys/jaas.pk";
const USER_NAME = process.env.JAAS_USER_NAME || "Mangodoro Dev";
const USER_EMAIL = process.env.JAAS_USER_EMAIL || "";
const USER_ID = process.env.JAAS_USER_ID || "dev-local";
const EXP_HOURS = 2;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!APP_ID) {
  fail("Missing VITE_JITSI_APP_ID in .env (vpaas-magic-cookie-…).");
}
if (!KID) {
  fail(
    "Missing JAAS_KID in .env. Get it from JaaS Console → API Keys → "
      + "the 'ID' column (e.g. vpaas-magic-cookie-…/6373c6)."
  );
}

let privateKey;
try {
  privateKey = readFileSync(resolve(KEY_PATH), "utf8");
} catch (e) {
  fail(
    `Couldn't read the JaaS private key at "${KEY_PATH}".\n`
      + `   Set JAAS_PRIVATE_KEY_PATH in .env to wherever you saved the\n`
      + `   .pk file, or move/copy the file to ./private-keys/jaas.pk.\n`
      + `   (${e.message})`
  );
}

// base64url variant used by JWT — strips trailing '=' padding,
// replaces '+/' with '-_'.
function b64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const now = Math.floor(Date.now() / 1000);
const exp = now + EXP_HOURS * 60 * 60;

// JaaS JWT spec: https://developer.8x8.com/jaas/docs/api-keys-jwt
const header = { alg: "RS256", typ: "JWT", kid: KID };
const payload = {
  aud: "jitsi",
  iss: "chat",
  iat: now,
  exp,
  nbf: now - 10, // small clock-skew tolerance
  sub: APP_ID,
  room: "*",     // wildcard — any room in this tenant
  context: {
    features: {
      livestreaming: true,
      "file-upload": true,
      "outbound-call": false,
      "sip-outbound-call": false,
      transcription: true,
      "list-visitors": false,
      recording: true,
      flip: false,
    },
    user: {
      "hidden-from-recorder": false,
      moderator: true,
      name: USER_NAME,
      id: USER_ID,
      avatar: "",
      email: USER_EMAIL,
    },
  },
};

const headerB64 = b64url(JSON.stringify(header));
const payloadB64 = b64url(JSON.stringify(payload));
const signingInput = `${headerB64}.${payloadB64}`;

const signer = createSign("RSA-SHA256");
signer.update(signingInput);
signer.end();
const signature = b64url(signer.sign(privateKey));

const jwt = `${signingInput}.${signature}`;

console.log("\n📋 Paste this into .env as VITE_JITSI_DEV_JWT, then restart Vite:\n");
console.log(jwt);
console.log(`\n⏰ Expires: ${new Date(exp * 1000).toISOString()}  (${EXP_HOURS}h from now)`);
console.log(`🔑 kid: ${KID}\n`);
