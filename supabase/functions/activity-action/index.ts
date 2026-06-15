// activity-action: called by the widget extension on a lockscreen tap.
// No user JWT — auth is the per-activity raw secret (SHA256 must equal
// the secret_hash we stored at register time). Looks up the row, reads
// the last-known content state, computes the new state for "toggle" or
// "stop", sends an APNs Live Activity push, persists the new state,
// returns it.
//
// Body:
//   {
//     activity_id: string,
//     secret: string,            // raw secret (hex), NOT the hash
//     action: "toggle" | "stop"
//   }
//
// Response:
//   { ok, new_state, apns_status, ended }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendLiveActivityPush } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// Constant-time string compare to avoid timing oracle on the hash check.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type ContentState = {
  endsAtEpochMs?: number;
  pausedSecondsLeft?: number | null;
  mode?: string;
  label?: string;
  isSynced?: boolean;
  isRunning?: boolean;
  accentColorHex?: string | null;
};

function computeNext(action: "toggle" | "stop", current: ContentState): ContentState {
  const nowMs = Date.now();
  if (action === "stop") {
    return { ...current, isRunning: false, pausedSecondsLeft: 0 };
  }
  // toggle
  if (current.isRunning) {
    const remaining = Math.max(
      0,
      Math.floor(((current.endsAtEpochMs ?? nowMs) - nowMs) / 1000),
    );
    return { ...current, isRunning: false, pausedSecondsLeft: remaining };
  }
  const remainingMs = (current.pausedSecondsLeft ?? 0) * 1000;
  return {
    ...current,
    isRunning: true,
    endsAtEpochMs: nowMs + remainingMs,
    pausedSecondsLeft: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const activityId = String(body.activity_id ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  const action = body.action === "stop" ? "stop" : body.action === "toggle" ? "toggle" : null;
  if (!activityId || !secret || !action) {
    return json(400, { error: "missing activity_id / secret / action" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: row, error: lookupError } = await admin
    .from("pomodoro_activity_tokens")
    .select("activity_id, push_token, secret_hash, apns_env, state")
    .eq("activity_id", activityId)
    .is("ended_at", null)
    .maybeSingle();
  if (lookupError) {
    console.error("lookup failed", lookupError);
    return json(500, { error: "db lookup failed" });
  }
  if (!row) return json(404, { error: "activity not found" });

  const provided = await sha256Hex(secret);
  if (!timingSafeEqual(provided, String(row.secret_hash).toLowerCase())) {
    return json(403, { error: "invalid secret" });
  }

  // Prefer the widget's forwarded state (mirrored from the host on every
  // start/update/pause) over our stored snapshot, since the host can
  // change state between server-round-trips. Falls back to the stored
  // state if the widget didn't include one.
  const passedState = body.current_state as ContentState | undefined;
  const current = (passedState ?? (row.state ?? {})) as ContentState;
  const next = computeNext(action, current);
  const event: "update" | "end" = action === "stop" ? "end" : "update";

  // Send APNs first; if it fails we still persist so the host app
  // reconciles on next foreground (and we surface the apns status to
  // the widget so it can log it).
  const apnsResult = await sendLiveActivityPush({
    pushToken: row.push_token,
    event,
    apnsEnv: row.apns_env as "production" | "sandbox",
    contentState: {
      endsAtEpochMs: next.endsAtEpochMs ?? 0,
      pausedSecondsLeft: next.pausedSecondsLeft ?? null,
      mode: next.mode ?? "work",
      label: next.label ?? "Pomodoro",
      isSynced: next.isSynced ?? false,
      isRunning: next.isRunning ?? false,
      accentColorHex: next.accentColorHex ?? null,
    },
  });
  if (!apnsResult.ok) {
    console.error("apns push failed", apnsResult.status, apnsResult.body);
  }

  const updates: Record<string, unknown> = { state: next };
  if (event === "end") updates.ended_at = new Date().toISOString();
  const { error: updateError } = await admin
    .from("pomodoro_activity_tokens")
    .update(updates)
    .eq("activity_id", activityId);
  if (updateError) console.error("persist failed", updateError);

  return json(200, {
    ok: apnsResult.ok,
    apns_status: apnsResult.status,
    apns_id: apnsResult.apnsId,
    new_state: next,
    ended: event === "end",
  });
});
