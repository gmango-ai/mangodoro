// mint-jaas-jwt
//
// Returns a freshly-signed JaaS JWT for the calling user so the
// browser embed can join a JaaS room without us shipping a long-lived
// signing key to the client.
//
// Auth: the function requires a Supabase user JWT (verify_jwt = true
// in supabase/config.toml or whatever the project sets). The user's
// id and email come from auth.getUser() — clients can supply a
// display name as a hint but cannot impersonate (the JWT's user.id
// is always the authenticated uid).
//
// Body (all optional):
//   { display_name?: string, room?: string, ttl_seconds?: number }
//
// Response:
//   { jwt: string, exp: number }     // exp = unix seconds
//
// Secrets the function reads (set via `supabase secrets set`):
//   JAAS_APP_ID         — vpaas-magic-cookie-…
//   JAAS_KID            — AppID/ShortKeyID from JaaS console
//   JAAS_PRIVATE_KEY    — PKCS#8 PEM body of the .pk file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signJaasJwt } from "../_shared/jaas-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const JAAS_APP_ID = Deno.env.get("JAAS_APP_ID") ?? "";
const JAAS_KID = Deno.env.get("JAAS_KID") ?? "";
const JAAS_PRIVATE_KEY = Deno.env.get("JAAS_PRIVATE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!JAAS_APP_ID || !JAAS_KID || !JAAS_PRIVATE_KEY) {
    return json(500, {
      error:
        "JaaS secrets missing. Set JAAS_APP_ID, JAAS_KID, JAAS_PRIVATE_KEY via `supabase secrets set`.",
    });
  }

  // Auth — the user JWT comes in via the Authorization header.
  // Match the case-insensitive pattern + persistSession:false config
  // that activity-register uses; both matter inside the edge runtime.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "Missing bearer token" });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    console.error("[mint-jaas-jwt] auth failed", userErr);
    return json(401, { error: "Invalid session" });
  }
  const user = userResult.user;

  // Body is optional — clients can supply display name + room.
  let body: { display_name?: string; room?: string; ttl_seconds?: number } = {};
  try {
    if (req.headers.get("Content-Length") !== "0") {
      body = await req.json();
    }
  } catch {
    // Empty / non-JSON bodies are fine — we use sensible defaults.
  }

  // Cap the TTL so a misbehaving client can't mint a year-long token.
  // 2h matches the JaaS console default; the embed re-mints on next
  // entry anyway.
  const ttl = Math.min(
    Math.max(60, body.ttl_seconds ?? 2 * 60 * 60),
    4 * 60 * 60,
  );

  try {
    const { jwt, exp } = await signJaasJwt({
      appId: JAAS_APP_ID,
      kid: JAAS_KID,
      privateKeyPem: JAAS_PRIVATE_KEY,
      ttlSeconds: ttl,
      room: body.room ?? "*",
      user: {
        id: user.id,
        // Display name and email are hints embedded in the call
        // metadata. The auth uid is the source of truth for who the
        // user is server-side.
        name: (body.display_name || user.user_metadata?.name || user.email || "Mangodoro user")
          .toString()
          .slice(0, 80),
        email: user.email ?? "",
      },
    });
    return json(200, { jwt, exp });
  } catch (e) {
    console.error("[mint-jaas-jwt] signing failed", e);
    return json(500, { error: "Could not mint JaaS JWT" });
  }
});
