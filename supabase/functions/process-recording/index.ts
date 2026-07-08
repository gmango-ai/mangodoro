// process-recording
//
// Internal pipeline: download a finished recording's audio, transcribe it with
// Cartesia Ink (ink-whisper), summarize the transcript with DeepSeek, store both,
// flip the recording to `ready`, and notify the meeting's participants. Invoked
// (fire-and-forget) by egress-webhook after an egress ends.
//
// Not a user endpoint — guarded by the shared PIPELINE_SECRET header, and runs
// with the service role (bypasses RLS). Never throws: on failure it marks the
// recording `failed` and returns 200 so the caller doesn't retry-loop.
//
// Secrets: PIPELINE_SECRET, CARTESIA_API_KEY (STT), DEEPSEEK_API_KEY (summary).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PIPELINE_SECRET = Deno.env.get("PIPELINE_SECRET") ?? "";
const CARTESIA_API_KEY = Deno.env.get("CARTESIA_API_KEY") ?? "";
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";

// Cartesia batch STT auto-chunks arbitrarily long audio, so this cap only guards
// against pulling a pathologically large blob into the function's memory.
const STT_MAX_BYTES = 100 * 1024 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Cartesia returns word-level timing; group words into readable sentence-ish
// segments for the transcript view (and future per-segment timestamp use).
function groupWordsIntoSegments(
  words: Array<{ word?: string; start?: number; end?: number }>,
) {
  const segs: Array<{ chunk_index: number; start: number | null; end: number | null; text: string }> = [];
  let cur: Array<{ word?: string; start?: number; end?: number }> = [];
  let idx = 0;
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      chunk_index: idx++,
      start: cur[0].start ?? null,
      end: cur[cur.length - 1].end ?? null,
      text: cur.map((w) => w.word ?? "").join(" ").replace(/\s+([.,!?;:])/g, "$1").trim(),
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]$/.test((w.word ?? "").trim()) || cur.length >= 60) flush();
  }
  flush();
  return segs;
}

const SUMMARY_SYSTEM = [
  "You summarize meeting transcripts. Reply ONLY with a JSON object of the shape:",
  '{ "summary_md": string, "key_points": string[], "action_items": [{ "text": string, "assignee": string | null }] }.',
  "summary_md is concise GitHub-flavored markdown (a short paragraph plus bullet highlights).",
  "key_points are the most important takeaways. action_items are concrete follow-ups with an assignee name when one is clearly stated, else null.",
  "If the transcript is empty or unintelligible, return empty arrays and a one-line summary_md saying so.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!PIPELINE_SECRET || req.headers.get("x-pipeline-secret") !== PIPELINE_SECRET) {
    return json(401, { error: "unauthorized" });
  }
  if (!SERVICE_ROLE_KEY) return json(500, { error: "service role missing" });

  let recordingId = "";
  try {
    recordingId = (await req.json())?.recording_id ?? "";
  } catch {
    return json(400, { error: "bad json" });
  }
  if (!recordingId) return json(400, { error: "recording_id required" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const fail = async (msg: string) => {
    await admin.from("meeting_recordings")
      .update({ status: "failed", error: msg.slice(0, 500) })
      .eq("id", recordingId);
    return json(200, { ok: false, error: msg });
  };

  const { data: rec, error: recErr } = await admin
    .from("meeting_recordings")
    .select("id, team_id, room_id, started_by, participant_ids, storage_path, file_bytes")
    .eq("id", recordingId)
    .maybeSingle();
  if (recErr || !rec) return json(404, { error: "recording not found" });
  if (!rec.storage_path) return await fail("no audio file recorded");
  if (!CARTESIA_API_KEY) return await fail("CARTESIA_API_KEY not configured");
  if (!DEEPSEEK_API_KEY) return await fail("DEEPSEEK_API_KEY not configured");

  try {
    // ── download the audio ──
    const dl = await admin.storage.from("meeting-recordings").download(rec.storage_path);
    if (dl.error || !dl.data) return await fail(`could not download audio: ${dl.error?.message ?? "missing"}`);
    const blob = dl.data;
    if (blob.size > STT_MAX_BYTES) {
      return await fail(`recording too large to transcribe (${Math.round(blob.size / 1e6)} MB)`);
    }

    // ── transcribe (Cartesia Ink / ink-whisper) ──
    const form = new FormData();
    form.append("file", blob, "audio.ogg");
    form.append("model", "ink-whisper");
    form.append("timestamp_granularities[]", "word");
    const sttRes = await fetch("https://api.cartesia.ai/stt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CARTESIA_API_KEY}`,
        "Cartesia-Version": "2026-03-01",
      },
      body: form,
    });
    if (!sttRes.ok) {
      return await fail(`transcription failed (${sttRes.status}): ${(await sttRes.text()).slice(0, 300)}`);
    }
    const stt = await sttRes.json() as {
      text?: string;
      language?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
    };
    const fullText = (stt.text ?? "").trim();
    const segments = groupWordsIntoSegments(stt.words ?? []);

    await admin.from("meeting_transcripts").upsert({
      recording_id: recordingId,
      language: stt.language ?? null,
      full_text: fullText,
      segments,
      provider: "ink-whisper",
    }, { onConflict: "recording_id" });

    // ── summarize (DeepSeek) ──
    let summaryMd = "";
    let keyPoints: unknown[] = [];
    let actionItems: unknown[] = [];
    if (fullText) {
      const sumRes = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          response_format: { type: "json_object" },
          temperature: 0.3,
          messages: [
            { role: "system", content: SUMMARY_SYSTEM },
            { role: "user", content: `Transcript:\n\n${fullText.slice(0, 200000)}` },
          ],
        }),
      });
      if (sumRes.ok) {
        try {
          const raw = (await sumRes.json())?.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw);
          summaryMd = typeof parsed.summary_md === "string" ? parsed.summary_md : "";
          keyPoints = Array.isArray(parsed.key_points) ? parsed.key_points : [];
          actionItems = Array.isArray(parsed.action_items) ? parsed.action_items : [];
        } catch (e) {
          console.error("[process-recording] summary parse failed", e);
        }
      } else {
        console.error("[process-recording] summary failed", sumRes.status, (await sumRes.text()).slice(0, 300));
      }
    }

    await admin.from("meeting_summaries").upsert({
      recording_id: recordingId,
      summary_md: summaryMd,
      key_points: keyPoints,
      action_items: actionItems,
      model: "deepseek-chat",
    }, { onConflict: "recording_id" });

    await admin.from("meeting_recordings").update({ status: "ready" }).eq("id", recordingId);

    // ── notify participants ──
    const recipients: string[] = Array.isArray(rec.participant_ids) ? rec.participant_ids : [];
    for (const uid of recipients) {
      if (!uid) continue;
      const { error: notifErr } = await admin.rpc("emit_notification", {
        p_recipient: uid,
        p_type: "meeting_summary",
        p_title: "Meeting summary ready",
        p_body: summaryMd ? summaryMd.replace(/\s+/g, " ").slice(0, 140) : "Your meeting has been transcribed.",
        p_payload: { room_id: rec.room_id, recording_id: recordingId },
        p_actor: null,
        p_team_id: rec.team_id,
        p_entity_type: "meeting_recording",
        p_entity_id: recordingId,
        p_dedupe_key: `meeting_summary:${recordingId}`,
      });
      if (notifErr) console.error("[process-recording] notify failed", uid, notifErr.message);
    }

    return json(200, { ok: true, recording_id: recordingId });
  } catch (e) {
    console.error("[process-recording] pipeline error", e);
    return await fail(String(e));
  }
});
