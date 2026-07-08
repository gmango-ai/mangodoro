// start-egress
//
// Starts recording a room's call: an audio-only LiveKit RoomComposite egress
// that writes an OGG file to the private `meeting-recordings` Supabase Storage
// bucket (via its S3-compatible endpoint). Inserts a `meeting_recordings` row
// (status → recording) that the client subscribes to for the REC indicator, and
// that the egress webhook later drives through the transcription pipeline.
//
// Authority: the active sync-session LEADER for the room, or an org admin/owner
// of the room's team (same model as livekit-moderate). Never trusted from the
// client — re-verified here with the service role.
//
// Body: { room_id }
// Returns: { ok: true, recording_id } | { error }
//
// Secrets (supabase secrets set):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
//   EGRESS_S3_ACCESS_KEY, EGRESS_S3_SECRET, EGRESS_S3_ENDPOINT,
//   EGRESS_S3_REGION, EGRESS_S3_BUCKET  (the meeting-recordings bucket, S3 API)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signLiveKitAdminToken } from "../_shared/livekit-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL") ?? "";
const S3_ACCESS_KEY = Deno.env.get("EGRESS_S3_ACCESS_KEY") ?? "";
const S3_SECRET = Deno.env.get("EGRESS_S3_SECRET") ?? "";
const S3_ENDPOINT = Deno.env.get("EGRESS_S3_ENDPOINT") ?? "";
const S3_REGION = Deno.env.get("EGRESS_S3_REGION") ?? "";
const S3_BUCKET = Deno.env.get("EGRESS_S3_BUCKET") ?? "meeting-recordings";

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

// Call a LiveKit Egress method over Twirp. Like RoomService, LiveKit expects
// lowerCamelCase JSON field names.
async function egressService(host: string, token: string, method: string, body: unknown) {
  const res = await fetch(`${host}/twirp/livekit.Egress/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LiveKit Egress ${method} ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const missingSecrets = [
    !LIVEKIT_API_KEY && "LIVEKIT_API_KEY",
    !LIVEKIT_API_SECRET && "LIVEKIT_API_SECRET",
    !LIVEKIT_URL && "LIVEKIT_URL",
    !S3_ACCESS_KEY && "EGRESS_S3_ACCESS_KEY",
    !S3_SECRET && "EGRESS_S3_SECRET",
    !S3_ENDPOINT && "EGRESS_S3_ENDPOINT",
    !S3_REGION && "EGRESS_S3_REGION",
  ].filter(Boolean);
  if (missingSecrets.length) {
    return json(500, {
      error: `Recording not configured — missing secret(s): ${missingSecrets.join(", ")}. Set via \`supabase secrets set\`.`,
    });
  }
  if (!SERVICE_ROLE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });

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

  // ── parse ──
  let body: { room_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const roomId = (body.room_id || "").trim();
  if (!roomId) return json(400, { error: "room_id is required" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ── room + team ──
  const { data: roomRow, error: roomErr } = await admin
    .from("rooms")
    .select("team_id")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr) {
    console.error("[start-egress] room lookup failed", roomErr);
    return json(500, { error: "Could not verify room" });
  }
  if (!roomRow) return json(404, { error: "Room not found" });

  // ── active session (leader authority + participant snapshot) ──
  const { data: sess, error: sessErr } = await admin
    .from("sync_sessions")
    .select("id, leader_id")
    .eq("room_id", roomId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sessErr) {
    console.error("[start-egress] session lookup failed", sessErr);
    return json(500, { error: "Could not verify session" });
  }
  if (!sess) return json(404, { error: "No active session for this room" });

  // Authorize: session leader OR org admin/owner of the room's team.
  let allowed = sess.leader_id === caller.id;
  if (!allowed) {
    const { data: membership } = await admin
      .from("team_members")
      .select("role, is_owner")
      .eq("team_id", roomRow.team_id)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (membership && (membership.role === "admin" || membership.is_owner === true)) allowed = true;
  }
  if (!allowed) {
    return json(403, { error: "Only the session leader or a team admin can start recording" });
  }

  // ── one active recording per room ──
  const { data: existing } = await admin
    .from("meeting_recordings")
    .select("id")
    .eq("room_id", roomId)
    .in("status", ["starting", "recording"])
    .limit(1)
    .maybeSingle();
  if (existing) return json(409, { error: "This room is already being recorded", recording_id: existing.id });

  // ── snapshot participants (they're hard-deleted when the session ends) ──
  const { data: parts } = await admin
    .from("sync_session_participants")
    .select("user_id")
    .eq("session_id", sess.id)
    .is("left_at", null);
  const participantIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));

  const livekitRoom = `${ROOM_PREFIX}${roomId}`;

  // ── insert the recording row (status: starting) ──
  const { data: rec, error: insErr } = await admin
    .from("meeting_recordings")
    .insert({
      room_id: roomId,
      team_id: roomRow.team_id,
      session_id: sess.id,
      livekit_room: livekitRoom,
      started_by: caller.id,
      participant_ids: participantIds,
      status: "starting",
    })
    .select("id")
    .single();
  if (insErr || !rec) {
    console.error("[start-egress] insert failed", insErr);
    return json(500, { error: "Could not create recording" });
  }
  const recordingId = rec.id as string;
  const filepath = `${roomId}/${recordingId}/audio.ogg`;

  // ── start the egress ──
  try {
    const { token } = await signLiveKitAdminToken({
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      room: livekitRoom,
      record: true,
    });
    const resp = await egressService(httpHost(LIVEKIT_URL), token, "StartRoomCompositeEgress", {
      roomName: livekitRoom,
      audioOnly: true,
      fileOutputs: [{
        fileType: "OGG",
        filepath,
        s3: {
          accessKey: S3_ACCESS_KEY,
          secret: S3_SECRET,
          region: S3_REGION,
          endpoint: S3_ENDPOINT,
          bucket: S3_BUCKET,
          forcePathStyle: true,
        },
      }],
    });
    // LiveKit's Twirp response may be camelCase or snake_case depending on
    // version — accept both (and log if neither so we can see the shape).
    const r = resp as { egressId?: string; egress_id?: string };
    const egressId = r.egressId ?? r.egress_id ?? null;
    if (!egressId) {
      console.error("[start-egress] no egress id in StartRoomCompositeEgress response:", JSON.stringify(resp).slice(0, 800));
    }
    await admin
      .from("meeting_recordings")
      .update({ egress_id: egressId, storage_path: filepath, status: "recording" })
      .eq("id", recordingId);
    return json(200, { ok: true, recording_id: recordingId });
  } catch (e) {
    console.error("[start-egress] egress start failed", e);
    await admin
      .from("meeting_recordings")
      .update({ status: "failed", error: String(e).slice(0, 500), ended_at: new Date().toISOString() })
      .eq("id", recordingId);
    return json(502, { error: "Could not start recording" });
  }
});
