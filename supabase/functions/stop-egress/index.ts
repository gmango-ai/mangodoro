// stop-egress
//
// Stops a room's active recording (the toggle-off path, and the best-effort call
// from end_sync_session). Sends StopEgress to LiveKit and parks the row at
// `processing` — the egress webhook then finalizes it and kicks off the pipeline.
// (LiveKit also ends a RoomComposite egress on room-empty timeout, so a forgotten
// recording still finalizes.)
//
// Authority: the active session leader, an org admin/owner, or whoever started
// the recording. Body: { room_id } or { recording_id }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { signLiveKitAdminToken } from "../_shared/livekit-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL") ?? "";

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
  ].filter(Boolean);
  if (missingSecrets.length) {
    return json(500, { error: `LiveKit not configured — missing: ${missingSecrets.join(", ")}` });
  }
  if (!SERVICE_ROLE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });

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

  let body: { room_id?: string; recording_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const roomId = (body.room_id || "").trim();
  const recordingId = (body.recording_id || "").trim();
  if (!roomId && !recordingId) return json(400, { error: "room_id or recording_id is required" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Find the active recording (by explicit id, else the room's in-flight one).
  let q = admin
    .from("meeting_recordings")
    .select("id, room_id, team_id, egress_id, started_by, status");
  q = recordingId ? q.eq("id", recordingId) : q.eq("room_id", roomId).in("status", ["starting", "recording"]);
  const { data: rec, error: recErr } = await q
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recErr) {
    console.error("[stop-egress] recording lookup failed", recErr);
    return json(500, { error: "Could not look up recording" });
  }
  if (!rec) return json(404, { error: "No active recording found" });
  if (rec.status === "processing" || rec.status === "ready" || rec.status === "stopped") {
    return json(200, { ok: true, recording_id: rec.id }); // already stopped/finalizing
  }

  // Authorize: recording starter, active session leader, or org admin/owner.
  let allowed = rec.started_by === caller.id;
  if (!allowed) {
    const { data: sess } = await admin
      .from("sync_sessions")
      .select("leader_id")
      .eq("room_id", rec.room_id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sess && sess.leader_id === caller.id) allowed = true;
  }
  if (!allowed) {
    const { data: membership } = await admin
      .from("team_members")
      .select("role, is_owner")
      .eq("team_id", rec.team_id)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (membership && (membership.role === "admin" || membership.is_owner === true)) allowed = true;
  }
  if (!allowed) return json(403, { error: "You don't have permission to stop this recording" });

  // Stop the egress. Resolve the egress id from the row, or — if start-egress
  // failed to capture it — look up the room's active egress(es) via ListEgress so
  // recording always stops on toggle-off (not just when the room empties).
  try {
    const { token } = await signLiveKitAdminToken({
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      room: `mangodoro-${rec.room_id}`,
      record: true,
    });
    const host = httpHost(LIVEKIT_URL);
    let egressIds: string[] = rec.egress_id ? [rec.egress_id] : [];
    if (!egressIds.length) {
      const list = await egressService(host, token, "ListEgress", {
        roomName: `mangodoro-${rec.room_id}`,
        active: true,
      }) as { items?: Array<{ egressId?: string; egress_id?: string }> };
      egressIds = (list.items ?? []).map((it) => it.egressId ?? it.egress_id ?? "").filter(Boolean);
      // Backfill so the egress webhook can correlate this row on end.
      if (egressIds.length) {
        await admin.from("meeting_recordings").update({ egress_id: egressIds[0] }).eq("id", rec.id);
      }
    }
    for (const eid of egressIds) {
      await egressService(host, token, "StopEgress", { egressId: eid });
    }
  } catch (e) {
    // Non-fatal: the webhook / room-empty close still finalizes the row.
    console.error("[stop-egress] stop failed (continuing)", e);
  }

  await admin
    .from("meeting_recordings")
    .update({ status: "processing", ended_at: new Date().toISOString() })
    .eq("id", rec.id)
    .in("status", ["starting", "recording"]);

  return json(200, { ok: true, recording_id: rec.id });
});
