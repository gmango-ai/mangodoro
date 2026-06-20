// activity-action: called by the widget extension on a lockscreen / home
// widget tap. No user JWT — auth is the per-activity raw secret (SHA256 must
// equal the secret_hash we stored at register time).
//
// It is AUTHORITATIVE: it toggles/stops against the user's real pomodoro
// state in the DB (`user_pomodoro_state` for a solo timer, or the
// `sync_sessions` row the user controls), writes the new state back to that
// table, and ONLY THEN updates the Live Activity (APNs) + the stored
// snapshot. Writing the DB is what makes the website update from a widget
// tap (it's subscribed to those tables via realtime), and reading the DB —
// instead of trusting the widget's forwarded `current_state`, which goes
// stale whenever the website changes the timer while the app is
// backgrounded — is what makes the toggle direction reliable instead of
// flipping the wrong way.
//
// Body:
//   {
//     activity_id: string,
//     secret: string,            // raw secret (hex), NOT the hash
//     action: "toggle" | "stop",
//     current_state?: object     // fallback only, used when no DB row exists
//   }
//
// Response:
//   { ok, new_state, apns_status, ended, source }

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

type DbRow = { is_running: boolean; remaining_seconds: number; ends_at: string | null; mode: string | null };

// Resolve the authoritative pomodoro state the widget's activity is tracking.
// Synced timers live in the sync_sessions row the user CONTROLS; solo timers
// live in user_pomodoro_state keyed by user_id. Returns null when there's no
// DB row to drive (e.g. the user is a non-controller participant, or has
// never synced) — the caller then falls back to the forwarded state and only
// updates the Live Activity, as before.
async function resolveDbSource(
  admin: ReturnType<typeof createClient>,
  userId: string | null,
  isSynced: boolean,
): Promise<{ table: "sync_sessions" | "user_pomodoro_state"; id: string; row: DbRow } | null> {
  if (!userId) return null;
  if (isSynced) {
    const { data, error } = await admin
      .from("sync_sessions")
      .select("id, is_running, remaining_seconds, ends_at, mode")
      .eq("controller_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) console.error("sync_sessions lookup failed", error);
    if (data) return { table: "sync_sessions", id: data.id as string, row: data as unknown as DbRow };
    return null; // synced but not the controller → don't hijack the session
  }
  const { data, error } = await admin
    .from("user_pomodoro_state")
    .select("is_running, remaining_seconds, ends_at, mode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) console.error("user_pomodoro_state lookup failed", error);
  if (data) return { table: "user_pomodoro_state", id: userId, row: data as unknown as DbRow };
  return null;
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
    .select("activity_id, user_id, push_token, secret_hash, apns_env, state")
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

  const stored = (row.state ?? {}) as ContentState;
  const userId = (row.user_id as string | null) ?? null;
  const isSynced = stored.isSynced === true;

  // Authoritative current state from the DB. We toggle FROM this, not from the
  // widget's forwarded current_state, which can be stale (the website may have
  // changed the timer while the app was backgrounded and couldn't mirror it).
  const dbSource = await resolveDbSource(admin, userId, isSynced);

  let current: ContentState;
  if (dbSource) {
    const r = dbSource.row;
    current = {
      ...stored,
      isRunning: r.is_running,
      endsAtEpochMs: r.ends_at ? new Date(r.ends_at).getTime() : (stored.endsAtEpochMs ?? 0),
      pausedSecondsLeft: r.is_running ? null : r.remaining_seconds,
      mode: r.mode ?? stored.mode,
    };
  } else {
    // Fallback: no DB row to drive — use the forwarded/stored snapshot and
    // only update the Live Activity (legacy behavior).
    const passedState = body.current_state as ContentState | undefined;
    current = (passedState ?? stored);
  }

  if (action === "toggle" && typeof current.isRunning !== "boolean") {
    return json(409, { error: "incomplete state" });
  }

  const next = computeNext(action, current);

  // Write the new state back to the DB FIRST so the website (subscribed to
  // these tables via realtime) updates even with the app backgrounded. The
  // before-trigger recomputes ends_at from {is_running, remaining_seconds}.
  if (dbSource) {
    // pause + stop both leave the DB timer PAUSED (stop also dismisses the
    // Live Activity via the "end" event below); resume runs it again from the
    // remaining it was paused at. We never zero the timer here — stop pauses
    // it where it stood rather than wiping the user's progress.
    const dbIsRunning = action === "toggle" ? (next.isRunning ?? false) : false;
    const remainingAtPause = current.isRunning
      ? Math.max(0, Math.floor(((current.endsAtEpochMs ?? Date.now()) - Date.now()) / 1000))
      : (current.pausedSecondsLeft ?? 0);
    const dbRemaining = dbIsRunning ? (current.pausedSecondsLeft ?? 0) : remainingAtPause;
    const { data: updated, error: writeError } = await admin
      .from(dbSource.table)
      .update({ is_running: dbIsRunning, remaining_seconds: Math.max(0, dbRemaining) })
      .eq(dbSource.table === "sync_sessions" ? "id" : "user_id", dbSource.id)
      .select("ends_at")
      .maybeSingle();
    if (writeError) {
      console.error(`${dbSource.table} write failed`, writeError);
      return json(500, { error: "db write failed" });
    }
    // Use the trigger-computed ends_at so the Live Activity matches the DB
    // exactly (no drift between the lockscreen countdown and the website).
    if (updated?.ends_at) next.endsAtEpochMs = new Date(updated.ends_at as string).getTime();
  }

  const event: "update" | "end" = action === "stop" ? "end" : "update";

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

  const tokenUpdates: Record<string, unknown> = { state: next };
  if (event === "end") tokenUpdates.ended_at = new Date().toISOString();
  const { error: updateError } = await admin
    .from("pomodoro_activity_tokens")
    .update(tokenUpdates)
    .eq("activity_id", activityId);
  if (updateError) {
    console.error("persist failed", updateError);
    return json(500, { error: "db persist failed" });
  }

  const responseBody = {
    ok: apnsResult.ok,
    apns_status: apnsResult.status,
    apns_id: apnsResult.apnsId,
    new_state: next,
    ended: event === "end",
    source: dbSource?.table ?? "fallback",
  };

  if (!apnsResult.ok) {
    return json(502, responseBody);
  }

  return json(200, responseBody);
});
