// google-token: mint a fresh Google access token from the caller's stored
// refresh token, so the app doesn't have to re-run the OAuth popup every hour.
//
// Auth: user JWT (Authorization: Bearer <jwt>). We resolve the user, read their
// refresh_token with the service role (RLS hides it from the client), and POST
// it to Google's token endpoint with the app's OAuth client credentials.
//
// Returns { access_token, expiry } on success. Returns { error: "no_refresh" }
// (400) when there's no stored refresh token, and { error: "refresh_failed" }
// (400) when Google rejects it (revoked / expired) — the client then falls back
// to a full re-auth.
//
// Secrets required (set via `supabase secrets set` or the dashboard — the same
// client id/secret configured in Supabase → Auth → Providers → Google):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

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

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    // Secrets not set yet (placeholder deploy) — tell the client so it can keep
    // using the current re-auth path instead of erroring.
    return json(503, { error: "not_configured" });
  }

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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: tokRow } = await admin
    .from("google_oauth_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  const refreshToken = tokRow?.refresh_token;
  if (!refreshToken) return json(400, { error: "no_refresh" });

  // Exchange the refresh token for a fresh access token.
  let tok: { access_token?: string; expires_in?: number; error?: string };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
    });
    tok = await res.json();
    if (!res.ok || !tok.access_token) {
      // invalid_grant → the refresh token was revoked/expired. Drop it so the
      // client stops trying to refresh and re-consents instead.
      if (tok?.error === "invalid_grant") {
        await admin.from("google_oauth_tokens").delete().eq("user_id", userId);
      }
      return json(400, { error: "refresh_failed", detail: tok?.error ?? null });
    }
  } catch (_e) {
    return json(502, { error: "google_unreachable" });
  }

  const expiry = Date.now() + Math.max(60, (tok.expires_in ?? 3600) - 60) * 1000;
  // Cache the fresh token on user_settings too (same place the client reads it).
  await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, google_access_token: tok.access_token, google_token_expiry: expiry },
      { onConflict: "user_id" },
    );

  return json(200, { access_token: tok.access_token, expiry });
});
