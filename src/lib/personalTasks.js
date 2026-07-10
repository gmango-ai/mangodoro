import { supabase } from "../supabase";

// Simple personal task tracker (the office "Tasks" widget). A private per-user
// checklist, scoped to a team so a multi-org member keeps separate lists. RLS
// restricts every row to its owner, and user_id defaults to auth.uid() so
// inserts don't need to pass it.

export async function listPersonalTasks(teamId) {
  let q = supabase
    .from("personal_tasks")
    .select("id, title, done, status, archived, sort_order, created_at, done_at, team_id");
  if (teamId) q = q.eq("team_id", teamId);
  const { data, error } = await q
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function addPersonalTask({ title, teamId }) {
  const clean = (title || "").trim();
  if (!clean) return { data: null, error: { message: "Task can't be empty" } };
  const { data, error } = await supabase
    .from("personal_tasks")
    .insert({ title: clean.slice(0, 200), team_id: teamId ?? null })
    .select("id, title, done, sort_order, created_at, done_at, team_id")
    .single();
  return { data, error };
}

export async function setPersonalTaskDone(id, done) {
  const { error } = await supabase
    .from("personal_tasks")
    .update({ done: !!done, done_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error };
}

export async function renamePersonalTask(id, title) {
  const clean = (title || "").trim();
  if (!clean) return { error: { message: "Task can't be empty" } };
  const { error } = await supabase
    .from("personal_tasks")
    .update({ title: clean.slice(0, 200), updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error };
}

export async function removePersonalTask(id) {
  const { error } = await supabase.from("personal_tasks").delete().eq("id", id);
  return { error };
}
