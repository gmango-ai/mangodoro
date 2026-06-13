import { supabase } from "../supabase";

// Per-session task tracking. While clocked in, the user can name what
// they're working on and switch tasks throughout the day. Each task
// is a `task_segments` row with started_at / ended_at; on clock-out
// they get linked to the entry row.

export async function startTaskSegment(description) {
  const { data, error } = await supabase.rpc("start_task_segment", {
    p_description: description || "",
  });
  return { data, error };
}

export async function updateOpenTaskSegment(description) {
  const { error } = await supabase.rpc("update_open_task_segment", {
    p_description: description || "",
  });
  return { error };
}

export async function stopTaskSegment() {
  const { error } = await supabase.rpc("stop_task_segment");
  return { error };
}

export async function linkSegmentsToEntry(entryId, since = null) {
  const { data, error } = await supabase.rpc("link_segments_to_entry", {
    p_entry_id: entryId,
    p_since: since ? new Date(since).toISOString() : null,
  });
  return { data, error };
}

// Current open task — at most one per user. Returns null if not
// clocked into a task.
export async function fetchCurrentTaskSegment() {
  const { data, error } = await supabase
    .from("task_segments")
    .select("id, description, started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

// All segments since a given timestamp — used to show "today's tasks"
// strip while clocked in.
export async function listRecentTaskSegments(since) {
  const { data, error } = await supabase
    .from("task_segments")
    .select("id, description, started_at, ended_at, entry_id")
    .gte("started_at", new Date(since).toISOString())
    .order("started_at", { ascending: false });
  return { data: data || [], error };
}

// Pull every segment linked to a specific entry. Used in the log to
// show "what tasks were worked on in this entry".
export async function listSegmentsForEntry(entryId) {
  if (!entryId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("task_segments")
    .select("id, description, started_at, ended_at")
    .eq("entry_id", entryId)
    .order("started_at", { ascending: true });
  return { data: data || [], error };
}
