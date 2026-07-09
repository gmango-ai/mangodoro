import { supabase } from "../supabase";

// Subtasks for planner_tasks + personal_tasks (one table, two nullable FKs —
// see 20260709130000_task_subtasks). RLS is own-rows-only.

// Batch-fetch subtasks for a set of parents. Returns two maps keyed by parent id.
export async function listSubtasks({ plannerIds = [], personalIds = [] } = {}) {
  const byPlanner = new Map();
  const byPersonal = new Map();
  const ids = [...plannerIds, ...personalIds];
  if (!ids.length) return { byPlanner, byPersonal };
  let q = supabase.from("task_subtasks").select("id, planner_task_id, personal_task_id, title, done, sort_order").order("sort_order");
  // OR across the two FK columns; either list may be empty.
  const ors = [];
  if (plannerIds.length) ors.push(`planner_task_id.in.(${plannerIds.join(",")})`);
  if (personalIds.length) ors.push(`personal_task_id.in.(${personalIds.join(",")})`);
  q = q.or(ors.join(","));
  const { data } = await q;
  (data || []).forEach((s) => {
    if (s.planner_task_id) {
      if (!byPlanner.has(s.planner_task_id)) byPlanner.set(s.planner_task_id, []);
      byPlanner.get(s.planner_task_id).push(s);
    } else if (s.personal_task_id) {
      if (!byPersonal.has(s.personal_task_id)) byPersonal.set(s.personal_task_id, []);
      byPersonal.get(s.personal_task_id).push(s);
    }
  });
  return { byPlanner, byPersonal };
}

// Subtasks for a single parent.
export async function fetchSubtasks({ plannerTaskId, personalTaskId }) {
  let q = supabase.from("task_subtasks").select("id, planner_task_id, personal_task_id, title, done, sort_order").order("sort_order");
  q = plannerTaskId ? q.eq("planner_task_id", plannerTaskId) : q.eq("personal_task_id", personalTaskId);
  return q;
}

export async function addSubtask({ plannerTaskId = null, personalTaskId = null, title, sortOrder = 0 }) {
  return supabase.from("task_subtasks")
    .insert({ planner_task_id: plannerTaskId, personal_task_id: personalTaskId, title, sort_order: sortOrder })
    .select()
    .single();
}

// Insert several subtasks (from AI suggestions) under one parent, in order.
export async function addSubtasks({ plannerTaskId = null, personalTaskId = null, titles = [], startOrder = 0 }) {
  const rows = titles.filter(Boolean).map((title, i) => ({
    planner_task_id: plannerTaskId, personal_task_id: personalTaskId, title, sort_order: startOrder + i,
  }));
  if (!rows.length) return { data: [] };
  return supabase.from("task_subtasks").insert(rows).select();
}

export async function setSubtaskDone(id, done) {
  return supabase.from("task_subtasks").update({ done }).eq("id", id);
}
export async function renameSubtask(id, title) {
  return supabase.from("task_subtasks").update({ title }).eq("id", id);
}
export async function deleteSubtask(id) {
  return supabase.from("task_subtasks").delete().eq("id", id);
}
export async function reorderSubtask(id, sortOrder) {
  return supabase.from("task_subtasks").update({ sort_order: sortOrder }).eq("id", id);
}

// { done, total, pct } — pct is 0-100 (0 when no subtasks).
export function subtaskProgress(subs) {
  const total = subs?.length || 0;
  const done = (subs || []).filter((s) => s.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
