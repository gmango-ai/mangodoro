import { supabase } from "../supabase";

// Client wrappers for the meeting-recording edge functions + review-page reads.
// The edge functions authorize the caller (session leader / team admin) server
// side — these are just thin invokers that normalize the { data, error } shape.

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export function startMeetingRecording(roomId) {
  return invoke("start-egress", { room_id: roomId });
}

export function stopMeetingRecording(roomId) {
  return invoke("stop-egress", { room_id: roomId });
}

// The review page: a team's recordings newest-first, each with its summary (if
// the pipeline has finished). meeting_summaries is embedded via its recording_id
// FK; with the one-per-recording unique index PostgREST returns it as an array,
// so callers normalize with `summary?.[0]`.
export async function listMeetingSummaries(teamId) {
  return supabase
    .from("meeting_recordings")
    .select(
      "id, room_id, status, started_at, ended_at, duration_seconds, participant_ids, started_by, " +
      "meeting_summaries(summary_md, key_points, action_items, exported_doc_url)",
    )
    .eq("team_id", teamId)
    .order("started_at", { ascending: false })
    .limit(100);
}

export async function getMeetingDetail(recordingId) {
  return supabase
    .from("meeting_recordings")
    .select("*, meeting_summaries(*), meeting_transcripts(*)")
    .eq("id", recordingId)
    .maybeSingle();
}

// Short-lived signed URL for the private recording audio. RLS on storage.objects
// (meeting-recordings: team reads) gates this to the room's team members.
// Pass a filename to get a download-disposition URL instead of inline playback.
export async function getRecordingAudioUrl(storagePath, { download = false, expiresIn = 3600 } = {}) {
  return supabase.storage
    .from("meeting-recordings")
    .createSignedUrl(storagePath, expiresIn, download ? { download } : undefined);
}

// Stamp a Google-Doc export onto a summary (SECURITY DEFINER RPC — the client
// created the doc in the foreground with its own Google token).
export function recordDocExport(recordingId, docId, docUrl) {
  return supabase.rpc("record_doc_export", {
    p_recording_id: recordingId,
    p_doc_id: docId,
    p_doc_url: docUrl,
  });
}
