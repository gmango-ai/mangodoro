import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { startMeetingRecording, stopMeetingRecording } from "../lib/meetingRecordings";

// Tracks the room's in-flight meeting recording and drives the toggle.
//
// The authoritative state is the meeting_recordings row (written by the egress
// edge functions / webhook with the service role). We read the room's active row
// and subscribe via Realtime so every participant's REC indicator flips together.
export function useMeetingRecording(roomId) {
  const [recording, setRecording] = useState(null); // active row or null
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) { setRecording(null); return; }
    const { data } = await supabase
      .from("meeting_recordings")
      .select("id, status, started_by, started_at")
      .eq("room_id", roomId)
      .in("status", ["starting", "recording", "processing"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRecording(data ?? null);
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!roomId) return undefined;
    const ch = supabase
      .channel(`meeting-rec:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meeting_recordings", filter: `room_id=eq.${roomId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId, load]);

  const start = useCallback(async () => {
    if (busy || !roomId) return { error: null };
    setBusy(true);
    const res = await startMeetingRecording(roomId);
    setBusy(false);
    if (!res.error) load();
    return res;
  }, [busy, roomId, load]);

  const stop = useCallback(async () => {
    if (busy || !roomId) return { error: null };
    setBusy(true);
    const res = await stopMeetingRecording(roomId);
    setBusy(false);
    if (!res.error) load();
    return res;
  }, [busy, roomId, load]);

  const status = recording?.status ?? null;
  const isActive = status === "starting" || status === "recording";

  return {
    recording,
    status,
    isActive,
    isProcessing: status === "processing",
    startedBy: recording?.started_by ?? null,
    busy,
    start,
    stop,
    reload: load,
  };
}
