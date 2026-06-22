// widget-start: home-screen widget "Start" tap. No user JWT — auth is the
// per-user widget secret (SHA256 must equal device_push_tokens.widget_secret_hash
// for that user+device). Starts a PERSONAL (solo) pomodoro: writes
// user_pomodoro_state to a running work phase (so the website updates via
// realtime), then push-to-starts the Live Activity and refreshes the home
// widget — all without opening the app.
//
// Body: { user_id: string, device_id: string, secret: string }
// Response: { ok, ends_at_ms?, already_running? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { maybePushToStart, refreshDeviceWidgets, labelForMode } from "../_shared/pushToStart.ts";

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
  let out = "";
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, "0");
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }

  const userId = String(body.user_id ?? "").trim();
  const deviceId = String(body.device_id ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  if (!userId || !deviceId || !secret) {
    return json(400, { error: "missing user_id / device_id / secret" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Authenticate via the per-user widget secret stored at registration.
  const { data: device, error: deviceError } = await admin
    .from("device_push_tokens")
    .select("widget_secret_hash")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (deviceError) {
    console.error("device lookup failed", deviceError);
    return json(500, { error: "db lookup failed" });
  }
  const hash = device?.widget_secret_hash as string | undefined;
  if (!hash) return json(403, { error: "device not registered" });
  if (!timingSafeEqual(await sha256Hex(secret), hash.toLowerCase())) {
    return json(403, { error: "invalid secret" });
  }

  // Already running → nothing to start (the widget only shows Start when idle,
  // but guard against a double tap).
  const { data: cur } = await admin
    .from("user_pomodoro_state")
    .select("is_running, durations")
    .eq("user_id", userId)
    .maybeSingle();
  if (cur?.is_running) return json(200, { ok: true, already_running: true });

  const durations = (cur?.durations ?? {}) as Record<string, number>;
  const workSecs = typeof durations.work === "number" && durations.work > 0 ? durations.work : 1500;

  // Start a fresh work phase. The before-trigger computes ends_at from
  // {is_running, remaining_seconds}; only the listed columns are written so the
  // user's session streak / durations are preserved.
  const { data: updated, error: writeError } = await admin
    .from("user_pomodoro_state")
    .upsert(
      { user_id: userId, mode: "work", is_running: true, remaining_seconds: workSecs, pending_mode: null },
      { onConflict: "user_id" },
    )
    .select("ends_at")
    .maybeSingle();
  if (writeError) {
    console.error("user_pomodoro_state write failed", writeError);
    return json(500, { error: "db write failed" });
  }

  const endsAtMs = updated?.ends_at ? new Date(updated.ends_at as string).getTime() : Date.now() + workSecs * 1000;
  const contentState = {
    endsAtEpochMs: endsAtMs,
    mode: "work",
    label: labelForMode("work"),
    isSynced: false,
    isRunning: true,
  };

  await maybePushToStart(admin, userId, contentState);
  await refreshDeviceWidgets(admin, userId, {
    ended: false,
    isRunning: true,
    endsAtMs,
    pausedSecondsLeft: null,
    mode: "work",
    isSynced: false,
  });

  return json(200, { ok: true, ends_at_ms: endsAtMs });
});
