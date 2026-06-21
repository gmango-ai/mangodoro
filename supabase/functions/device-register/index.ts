// device-register: the iOS host app calls this when it gets (or rotates) its
// APNs device token, so the server can send SILENT background pushes that
// refresh the home-screen widget when the shared pomodoro state changes on
// another device. Distinct from activity-register (per-Live-Activity tokens).
//
// Auth: user JWT (Authorization: Bearer <jwt>) — RLS enforces ownership, but
// we write with the service role after resolving the user (matches the
// activity-* functions).
//
// Body: { device_id: string, push_token: string, apns_env?: "production"|"sandbox" }
// Upserts one row per (user_id, device_id).

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
  const pushToken = String(body.push_token ?? "").trim().toLowerCase();
  if (!deviceId) return json(400, { error: "missing device_id" });
  if (!/^[0-9a-f]{8,}$/.test(pushToken)) {
    return json(400, { error: "push_token must be lowercase hex" });
  }
  const apnsEnv = body.apns_env === "sandbox" ? "sandbox" : "production";

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: upsertError } = await admin
    .from("device_push_tokens")
    .upsert(
      { user_id: userId, device_id: deviceId, push_token: pushToken, apns_env: apnsEnv },
      { onConflict: "user_id,device_id" },
    );
  if (upsertError) {
    console.error("device token upsert failed", upsertError);
    return json(500, { error: "db upsert failed" });
  }
  return json(200, { ok: true });
});
