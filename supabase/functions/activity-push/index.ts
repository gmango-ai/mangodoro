// activity-push: a client (any device) calls this when the shared pomodoro
// state changes, so the user's Live Activities on OTHER devices update via
// APNs without that device's app being foregrounded. Fixes "I paused on the
// browser but my phone's Live Activity didn't update until I opened the app."
//
// Auth: the caller's user JWT (Authorization: Bearer <jwt>). We push to every
// active Live Activity token registered for that user.
//
// Body:
//   {
//     isRunning: boolean,
//     endsAtMs?: number,            // when running
//     pausedSecondsLeft?: number,   // when paused
//     ended?: boolean               // true → end the activity
//   }
//
// Response: { ok, pushed }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendLiveActivityPush, sendBackgroundPush } from "../_shared/apns.ts";

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

  // Authenticate the caller and resolve their user id.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult?.user) return json(401, { error: "unauthorized" });
  const userId = userResult.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  const ended = body.ended === true;
  const isRunning = !ended && body.isRunning === true;
  const endsAtMs = typeof body.endsAtMs === "number" ? body.endsAtMs : undefined;
  const pausedSecondsLeft = typeof body.pausedSecondsLeft === "number" ? body.pausedSecondsLeft : undefined;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: rows, error: lookupError } = await admin
    .from("pomodoro_activity_tokens")
    .select("activity_id, push_token, apns_env, state")
    .eq("user_id", userId)
    .is("ended_at", null);
  if (lookupError) {
    console.error("token lookup failed", lookupError);
    return json(500, { error: "db lookup failed" });
  }

  let pushed = 0;
  for (const row of rows ?? []) {
    const prev = (row.state ?? {}) as Record<string, unknown>;
    // Merge the new running/timing onto the activity's last-known content so
    // mode / label / accent stay intact.
    const next = {
      endsAtEpochMs: isRunning ? (endsAtMs ?? (prev.endsAtEpochMs as number) ?? 0) : ((prev.endsAtEpochMs as number) ?? 0),
      pausedSecondsLeft: isRunning ? null : (pausedSecondsLeft ?? (prev.pausedSecondsLeft as number) ?? 0),
      mode: (prev.mode as string) ?? "work",
      label: (prev.label as string) ?? "Pomodoro",
      isSynced: (prev.isSynced as boolean) ?? true,
      isRunning,
      accentColorHex: (prev.accentColorHex as string | null) ?? null,
    };
    const res = await sendLiveActivityPush({
      pushToken: row.push_token as string,
      event: ended ? "end" : "update",
      apnsEnv: row.apns_env as "production" | "sandbox",
      contentState: next,
    });
    if (res.ok) pushed++;
    else console.error("apns push failed", res.status, res.body);

    const updates: Record<string, unknown> = { state: next };
    if (ended) updates.ended_at = new Date().toISOString();
    await admin.from("pomodoro_activity_tokens").update(updates).eq("activity_id", row.activity_id);
  }

  // Also refresh the home-screen widget on every registered device via a
  // silent background push. The home widget reads the App Group, which only
  // the app itself can write — so we wake the app to merge the new state and
  // reload its timeline. Runs even when the user has no Live Activity (rows
  // empty) so the home widget never goes stale after a cross-device change.
  const { data: devices, error: deviceLookupError } = await admin
    .from("device_push_tokens")
    .select("push_token, apns_env")
    .eq("user_id", userId);
  if (deviceLookupError) console.error("device token lookup failed", deviceLookupError);

  let silentPushed = 0;
  for (const d of devices ?? []) {
    const res = await sendBackgroundPush({
      pushToken: d.push_token as string,
      apnsEnv: d.apns_env as "production" | "sandbox",
      payload: {
        kind: "pomodoro-state",
        ended,
        isRunning,
        endsAtMs: endsAtMs ?? null,
        pausedSecondsLeft: pausedSecondsLeft ?? null,
        mode: typeof body.mode === "string" ? body.mode : null,
        isSynced: body.isSynced === true,
      },
    });
    if (res.ok) silentPushed++;
    else console.error("background push failed", res.status, res.body);
  }

  return json(200, { ok: true, pushed, silentPushed });
});
