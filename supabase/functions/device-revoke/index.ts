// device-revoke
//
// Org admin removes a device. Deletes the device's auth user, which kills its
// sessions immediately and cascades away its org_devices / org_device_secrets /
// user_settings rows (all FK-on-delete-cascade to auth.users).
//
// Body: { device_id: uuid }
// Auth: requires a Supabase user JWT; caller must be an admin of the device's org.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json(401, { error: "Missing bearer token" });
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userResult?.user) return json(401, { error: "Invalid session" });
  const caller = userResult.user;

  let body: { device_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const deviceId = (body.device_id || "").trim();
  if (!deviceId) return json(400, { error: "device_id is required" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: dev } = await admin
    .from("org_devices")
    .select("id, org_id, user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (!dev) return json(404, { error: "Device not found" });

  const { data: membership } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", dev.org_id)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (membership?.role !== "admin") return json(403, { error: "Only an org admin can remove devices" });

  const { error: delErr } = await admin.auth.admin.deleteUser(dev.user_id);
  if (delErr) {
    console.error("[device-revoke] deleteUser failed", delErr);
    return json(500, { error: "Could not remove device" });
  }
  return json(200, { ok: true });
});
