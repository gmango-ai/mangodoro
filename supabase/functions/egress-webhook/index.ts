// egress-webhook
//
// Public endpoint LiveKit calls when an egress changes state. There's no
// Supabase JWT — LiveKit signs the request, and we verify that signature
// (verifyLiveKitWebhook: the Authorization JWT's sha256 claim must match the
// raw body hash, and the JWT must be signed with our API secret).
//
// On `egress_ended` we finalize the meeting_recordings row and hand off to the
// (slower) process-recording pipeline via a fire-and-forget call — LiveKit
// retries non-2xx responses, so we must return 200 fast and NOT run Whisper here.
//
// Point your LiveKit project's webhook at this function's URL.
// Secrets: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PIPELINE_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { verifyLiveKitWebhook } from "../_shared/livekit-jwt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const PIPELINE_SECRET = Deno.env.get("PIPELINE_SECRET") ?? "";

// deno-lint-ignore no-explicit-any
const EdgeRuntime = (globalThis as any).EdgeRuntime;

function nsToSeconds(ns: number | string | undefined): number | null {
  if (ns === undefined || ns === null) return null;
  const n = typeof ns === "string" ? Number(ns) : ns;
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 1e9);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SERVICE_ROLE_KEY || !LIVEKIT_API_SECRET) {
    return new Response("not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const authHeader = req.headers.get("Authorization") ?? "";
  const ok = await verifyLiveKitWebhook(rawBody, authHeader, LIVEKIT_API_SECRET);
  if (!ok) return new Response("invalid signature", { status: 401 });

  // deno-lint-ignore no-explicit-any
  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const event: string = evt.event ?? "";
  // LiveKit field names can be camelCase or snake_case depending on version.
  const info = evt.egressInfo ?? evt.egress_info ?? {};
  const egressId: string | null = info.egressId ?? info.egress_id ?? null;
  if (!event) return new Response("ok", { status: 200 });

  // The recorded file. Its filename is the S3 key we set at start:
  // `{roomId}/{recordingId}/audio.ogg` — so the recordingId is the second-to-last
  // path segment. This lets us correlate even if start-egress missed the egress id.
  const fileRes = (info.fileResults ?? info.file_results ?? [])[0] ?? info.file ?? null;
  const filename: string | null = fileRes?.filename ?? fileRes?.location ?? null;
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  let recordingId: string | null = null;
  if (filename) {
    const parts = String(filename).split("/").filter(Boolean);
    const candidate = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (isUuid(candidate)) recordingId = candidate;
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (event === "egress_ended") {
    const status = String(info.status ?? "").toUpperCase();
    const failed = status.includes("FAIL") || status.includes("ABORT");
    const patch: Record<string, unknown> = { ended_at: new Date().toISOString() };
    if (failed) {
      patch.status = "failed";
      patch.error = `egress ${status || "failed"}`;
    } else {
      patch.status = "processing";
      if (filename) patch.storage_path = filename;
      const dur = nsToSeconds(fileRes?.duration);
      if (dur !== null) patch.duration_seconds = dur;
      if (fileRes?.size !== undefined && fileRes?.size !== null) patch.file_bytes = Number(fileRes.size) || null;
      if (egressId) patch.egress_id = egressId; // backfill if the row missed it
    }

    // Prefer correlating by recordingId (from the file key) — it's present even
    // when the egress id wasn't captured at start. Fall back to egress_id.
    let q = admin.from("meeting_recordings").update(patch);
    if (recordingId) q = q.eq("id", recordingId);
    else if (egressId) q = q.eq("egress_id", egressId);
    else {
      console.error("[egress-webhook] cannot correlate egress_ended", JSON.stringify(evt).slice(0, 600));
      return new Response("ok", { status: 200 });
    }
    const { data: rec, error: updErr } = await q.select("id, status").maybeSingle();
    if (updErr) console.error("[egress-webhook] row update failed", updErr.message);

    // Kick off the transcription/summary pipeline (fire-and-forget). Return 200
    // immediately regardless — LiveKit retries non-2xx.
    if (rec && rec.status === "processing" && PIPELINE_SECRET) {
      const call = fetch(`${SUPABASE_URL}/functions/v1/process-recording`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
          "x-pipeline-secret": PIPELINE_SECRET,
        },
        body: JSON.stringify({ recording_id: rec.id }),
      }).catch((e) => console.error("[egress-webhook] pipeline kickoff failed", e));
      if (EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(call); else await call;
    }
  }

  return new Response("ok", { status: 200 });
});
