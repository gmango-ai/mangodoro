// activity-state: secret-authed READ of an activity's current content state.
//
// The home-screen widget calls this on its timeline reloads so it can refresh
// to the SAME authoritative snapshot that drives the lock-screen / Dynamic
// Island Live Activity. The LA is kept fresh by APNs pushes (activity-action
// for taps, activity-push for website changes); the home widget can't be
// pushed, so it PULLS the latest pomodoro_activity_tokens.state here — keeping
// all three surfaces consistent even after the website changed the timer while
// the app was backgrounded.
//
// Auth: the per-activity raw secret (SHA256 must equal the stored secret_hash),
// same model as activity-action. No user JWT.
//
// Body:     { activity_id: string, secret: string }
// Response: { ok: true, state: object | null }  (404 if the activity ended)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

  const activityId = String(body.activity_id ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  if (!activityId || !secret) return json(400, { error: "missing activity_id / secret" });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: row, error } = await admin
    .from("pomodoro_activity_tokens")
    .select("secret_hash, state")
    .eq("activity_id", activityId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) {
    console.error("lookup failed", error);
    return json(500, { error: "db lookup failed" });
  }
  // 404 signals "ended / no active activity" so the widget can clear itself
  // rather than keep showing a stale session.
  if (!row) return json(404, { error: "activity not found" });

  const provided = await sha256Hex(secret);
  if (!timingSafeEqual(provided, String(row.secret_hash).toLowerCase())) {
    return json(403, { error: "invalid secret" });
  }

  return json(200, { ok: true, state: row.state ?? null });
});
