// activity-unregister: called by the iOS host app when a Live Activity
// ends from inside the app (stop/reset). Marks the server's row as
// ended so stale push tokens and secrets are not targeted.
//
// Auth: user JWT (Authorization: Bearer <jwt>).
//
// Body: { activity_id: string }

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
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
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const activityId = String(body.activity_id ?? "").trim();
  if (!activityId) return json(400, { error: "missing activity_id" });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: row, error: lookupError } = await admin
    .from("pomodoro_activity_tokens")
    .select("activity_id, ended_at")
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    console.error("unregister lookup failed", lookupError);
    return json(500, { error: "db lookup failed" });
  }
  if (!row) return json(404, { error: "activity not found" });
  if (row.ended_at) return json(200, { ok: true, already_ended: true });

  const { error: updateError } = await admin
    .from("pomodoro_activity_tokens")
    .update({ ended_at: new Date().toISOString() })
    .eq("activity_id", activityId)
    .eq("user_id", userId);

  if (updateError) {
    console.error("unregister update failed", updateError);
    return json(500, { error: "db update failed" });
  }

  return json(200, { ok: true });
});
