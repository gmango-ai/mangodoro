// livekit-moderate
//
// Host moderation for a room's video call: remove a participant, or mute one of
// their tracks. Authority is the room's sync-session LEADER — verified
// server-side here, never trusted from the client. Calls the LiveKit RoomService
// (Twirp/HTTP) with a short-lived roomAdmin token so the API secret never
// touches the browser. Counterpart to mint-livekit-token.
//
// Body:
//   { room_id: uuid, action: "kick" | "mute" | "unmute",
//     target_user_id: uuid, track_sid?: string }   // track_sid required for mute/unmute
//
// Auth: requires a Supabase user JWT (the caller). The caller must be the
// leader_id of the active sync_session for room_id.
//
// Secrets (set via `supabase secrets set`):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET  — LiveKit API credentials
//   LIVEKIT_URL                          — wss://<project>.livekit.cloud (or https://)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signLiveKitAdminToken } from "../_shared/livekit-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL") ?? "";

// Must match liveKitRoomName() in src/lib/livekit.js.
const ROOM_PREFIX = "mangodoro-";

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

function httpHost(url: string): string {
  return url
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/+$/, "");
}

// Call a LiveKit RoomService method over Twirp. LiveKit (Go/protojson) expects
// lowerCamelCase JSON field names (e.g. trackSid).
async function roomService(host: string, token: string, method: string, body: unknown) {
  const res = await fetch(`${host}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LiveKit ${method} ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return json(500, {
      error:
        "LiveKit not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL via `supabase secrets set`.",
    });
  }
  if (!SERVICE_ROLE_KEY) {
    return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });
  }

  // ── identify the caller ──
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "Missing bearer token" });
  }
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userResult?.user) return json(401, { error: "Invalid session" });
  const caller = userResult.user;

  // ── parse + validate ──
  let body: {
    room_id?: string;
    action?: string;
    target_user_id?: string;
    track_sid?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const roomId = (body.room_id || "").trim();
  const action = (body.action || "").trim();
  const targetUserId = (body.target_user_id || "").trim();
  const trackSid = (body.track_sid || "").trim();

  if (!roomId || !targetUserId) return json(400, { error: "room_id and target_user_id are required" });
  if (!["kick", "mute", "unmute"].includes(action)) return json(400, { error: "Invalid action" });
  if ((action === "mute" || action === "unmute") && !trackSid) {
    return json(400, { error: "track_sid is required to mute/unmute" });
  }

  // ── authorize: caller must be the active session's leader for this room ──
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: sess, error: sessErr } = await admin
    .from("sync_sessions")
    .select("leader_id")
    .eq("room_id", roomId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sessErr) {
    console.error("[livekit-moderate] session lookup failed", sessErr);
    return json(500, { error: "Could not verify session" });
  }
  if (!sess) return json(404, { error: "No active session for this room" });
  if (sess.leader_id !== caller.id) {
    return json(403, { error: "Only the session leader can moderate this call" });
  }

  // ── act ──
  const room = `${ROOM_PREFIX}${roomId}`;
  try {
    const { token } = await signLiveKitAdminToken({
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      room,
    });
    const host = httpHost(LIVEKIT_URL);
    if (action === "kick") {
      await roomService(host, token, "RemoveParticipant", { room, identity: targetUserId });
    } else {
      await roomService(host, token, "MutePublishedTrack", {
        room,
        identity: targetUserId,
        trackSid,
        muted: action === "mute",
      });
    }
    return json(200, { ok: true });
  } catch (e) {
    console.error("[livekit-moderate] action failed", e);
    return json(502, { error: "Moderation action failed" });
  }
});
