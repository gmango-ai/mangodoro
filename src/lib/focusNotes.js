import { supabase } from "../supabase";

// Focus notes — the reflections captured by the "What did you work on?" prompt,
// persisted as a durable journal with their optional Result status so they can
// be browsed on the profile. user_id defaults to auth.uid() in the DB; RLS
// keeps them own-rows.

export async function addFocusNote({ text, status } = {}) {
  const t = (text || "").trim();
  if (!t) return { error: null };
  const { error } = await supabase
    .from("focus_notes")
    .insert({ text: t, status: status || null });
  return { error };
}

// A user's own notes since a timestamp (ms epoch), newest-first.
export async function listRecentFocusNotes(since) {
  const { data, error } = await supabase
    .from("focus_notes")
    .select("id, text, status, created_at")
    .gte("created_at", new Date(since).toISOString())
    .order("created_at", { ascending: false });
  return { data: data || [], error };
}
