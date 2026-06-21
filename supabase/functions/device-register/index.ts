// device-register: the iOS host app calls this when it gets (or rotates) any of
// its device-level tokens, so the server can drive that device while the app is
// backgrounded. Distinct from activity-register (per-Live-Activity tokens).
//   - push_token        : APNs device token → silent home-widget refresh pushes
//   - pts_token         : ActivityKit push-to-start token → create Live Activity
//   - widget_secret_hash: SHA256 of the per-user widget secret → auth for the
//                         widget-start "Start" tap
//
// Auth: user JWT (Authorization: Bearer <jwt>) — RLS enforces ownership, but we
// write with the service role after resolving the user (matches activity-*).
//
// Body: { device_id, push_token?, pts_token?, widget_secret_hash?, apns_env? }
// Merges the provided fields into one row per (user_id, device_id) — fields can
// arrive in separate calls (APNs token is async, the secret is minted on init).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "missing bearer token" });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult.user) return json(401, { error: "invalid auth" });
  const userId = userResult.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const deviceId = String(body.device_id ?? "").trim();
  if (!deviceId) return json(400, { error: "missing device_id" });

  // Only the columns actually provided are written, so partial calls (token
  // before secret, etc.) merge instead of clobbering. device_id + apns_env are
  // always set so the row exists with a known environment.
  const row: Record<string, unknown> = {
    user_id: userId,
    device_id: deviceId,
    apns_env: body.apns_env === "sandbox" ? "sandbox" : "production",
  };

  const pushToken = String(body.push_token ?? "").trim().toLowerCase();
  if (pushToken) {
    if (!/^[0-9a-f]{8,}$/.test(pushToken)) return json(400, { error: "push_token must be lowercase hex" });
    row.push_token = pushToken;
  }
  const ptsToken = String(body.pts_token ?? "").trim().toLowerCase();
  if (ptsToken) {
    if (!/^[0-9a-f]{8,}$/.test(ptsToken)) return json(400, { error: "pts_token must be lowercase hex" });
    row.pts_token = ptsToken;
  }
  const widgetSecretHash = String(body.widget_secret_hash ?? "").trim().toLowerCase();
  if (widgetSecretHash) {
    if (!/^[0-9a-f]{64}$/.test(widgetSecretHash)) return json(400, { error: "widget_secret_hash must be 64-char hex" });
    row.widget_secret_hash = widgetSecretHash;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: upsertError } = await admin
    .from("device_push_tokens")
    .upsert(row, { onConflict: "user_id,device_id" });
  if (upsertError) {
    console.error("device token upsert failed", upsertError);
    return json(500, { error: "db upsert failed" });
  }
  return json(200, { ok: true });
});
