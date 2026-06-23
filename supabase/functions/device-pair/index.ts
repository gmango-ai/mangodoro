// device-pair  (verify_jwt = false — the device has no session yet)
//
// A device redeems its one-time pairing code for a Supabase session. The code is
// single-use and short-lived. We verify it, mint a session for the device's
// (synthetic) auth user server-side via its stored password, clear the code, and
// return the session tokens for the device to setSession() — the same shape any
// login produces, so the device persists/refreshes it normally.
//
// Body:     { code: string }
// Response: { access_token, refresh_token }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });

  let body: { code?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Canonicalize: strip anything but A-Z/0-9, uppercase, re-format as XXXX-XXXX,
  // so "4f9k2qxp", "4F9K-2QXP", "4f9k 2qxp" all match what was generated.
  const raw = (body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 8) return json(400, { error: "Invalid pairing code" });
  const canonical = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const codeHash = await sha256hex(canonical);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: dev } = await admin
    .from("org_devices")
    .select("id, user_id, pairing_expires_at, revoked_at")
    .eq("pairing_code_hash", codeHash)
    .maybeSingle();

  const expired = !dev?.pairing_expires_at || new Date(dev.pairing_expires_at).getTime() < Date.now();
  if (!dev || dev.revoked_at || expired) {
    return json(401, { error: "Invalid or expired pairing code" });
  }

  const { data: secret } = await admin
    .from("org_device_secrets")
    .select("password")
    .eq("user_id", dev.user_id)
    .maybeSingle();
  const { data: userData } = await admin.auth.admin.getUserById(dev.user_id);
  const email = userData?.user?.email;
  if (!secret?.password || !email) {
    console.error("[device-pair] missing device credentials");
    return json(500, { error: "Device is misconfigured" });
  }

  // Mint a session for the device user.
  const asDevice = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: signin, error: sErr } = await asDevice.auth.signInWithPassword({
    email,
    password: secret.password,
  });
  if (sErr || !signin?.session) {
    console.error("[device-pair] sign-in failed", sErr);
    return json(500, { error: "Could not establish device session" });
  }

  // Single-use: clear the code and stamp liveness.
  await admin
    .from("org_devices")
    .update({ pairing_code_hash: null, pairing_expires_at: null, last_seen_at: new Date().toISOString() })
    .eq("id", dev.id);

  return json(200, {
    access_token: signin.session.access_token,
    refresh_token: signin.session.refresh_token,
  });
});
