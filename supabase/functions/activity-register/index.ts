// activity-register: called by the iOS host app when a Live Activity
// starts, on push-token rotation, and on phase boundaries to keep the
// server's snapshot of the activity content state fresh so the next
// widget tap reads the right thing.
//
// Auth: user JWT (Authorization: Bearer <jwt>) — anon key is fine as
// the apikey header, RLS enforces ownership.
//
// Body (full register):
//   {
//     activity_id: string,
//     push_token: string,
//     secret_hash: string,
//     apns_env?: "production"|"sandbox",
//     state?: object
//   }
//
// Body (state sync only):
//   { activity_id: string, state: object }
//
// Upserts on activity_id for full register; state-only updates an owned
// active row.

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

function validateState(state: Record<string, unknown> | null): string | null {
  if (state === null) return null;
  if (typeof state.isRunning !== "boolean") {
    return "state.isRunning must be a boolean";
  }
  return null;
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

  const pushToken = String(body.push_token ?? "").trim();
  const secretHash = String(body.secret_hash ?? "").trim().toLowerCase();
  const state = (body.state ?? null) as Record<string, unknown> | null;
  const stateError = validateState(state);
  if (stateError) return json(400, { error: stateError });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // State-only sync: update owned active row without touching token fields.
  if (!pushToken && !secretHash) {
    if (!state) return json(400, { error: "missing state for state-only sync" });
    const { data: row, error: lookupError } = await admin
      .from("pomodoro_activity_tokens")
      .select("activity_id")
      .eq("activity_id", activityId)
      .eq("user_id", userId)
      .is("ended_at", null)
      .maybeSingle();
    if (lookupError) {
      console.error("state sync lookup failed", lookupError);
      return json(500, { error: "db lookup failed" });
    }
    if (!row) return json(404, { error: "activity not found" });
    const { error: updateError } = await admin
      .from("pomodoro_activity_tokens")
      .update({ state })
      .eq("activity_id", activityId)
      .eq("user_id", userId);
    if (updateError) {
      console.error("state sync update failed", updateError);
      return json(500, { error: "db update failed" });
    }
    return json(200, { ok: true });
  }

  if (!pushToken || !secretHash) {
    return json(400, { error: "missing push_token / secret_hash for full register" });
  }
  if (!/^[0-9a-f]{64}$/.test(secretHash)) {
    return json(400, { error: "secret_hash must be 64-char lowercase hex" });
  }

  const apnsEnv = body.apns_env === "sandbox" ? "sandbox" : "production";

  const { error: upsertError } = await admin
    .from("pomodoro_activity_tokens")
    .upsert(
      {
        user_id: userId,
        activity_id: activityId,
        push_token: pushToken,
        secret_hash: secretHash,
        apns_env: apnsEnv,
        state,
        ended_at: null,
      },
      { onConflict: "activity_id" },
    );

  if (upsertError) {
    console.error("upsert failed", upsertError);
    return json(500, { error: "db upsert failed" });
  }

  return json(200, { ok: true });
});
