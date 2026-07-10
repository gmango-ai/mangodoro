import { supabase } from "../supabase";
import { fetchSubtasks, subtaskProgress } from "./subtasks";

// Shared planner gamification math (mirrors PlannerPage) so surfaces outside
// the planner — e.g. the pomodoro focus panel — can recompute a task's
// progress + credited points consistently instead of duplicating the formula.

export function pointsForComplete(priority) {
  const p = Math.min(3, Math.max(0, priority | 0));
  return 10 + p * 5;
}

function targetCreditedForTask(done, progress, priority) {
  const max = pointsForComplete(priority);
  if (done) return max;
  const p = Math.min(99, Math.max(0, Math.round(Number(progress) || 0)));
  return Math.floor((max * p) / 100);
}

// The user's current focused (in_progress, not done) planner task, most-recent
// first, plus its subtasks. Returns { task, subtasks } or { task: null }.
export async function fetchFocusedTask(userId) {
  if (!userId) return { task: null, subtasks: [] };
  const { data } = await supabase
    .from("planner_tasks")
    .select("id, title, planner_date, priority, progress, done, points_awarded_for_task")
    .eq("user_id", userId)
    .eq("in_progress", true)
    .eq("done", false)
    .order("planner_date", { ascending: false, nullsFirst: false })
    .limit(1);
  const task = data?.[0] || null;
  if (!task) return { task: null, subtasks: [] };
  const { data: subs } = await fetchSubtasks({ plannerTaskId: task.id });
  return { task, subtasks: subs || [] };
}

// Recompute a planner task's progress + credited points from its current
// subtasks and adjust the planner_points total by the delta. No-op when the
// task is done (full credit stays) or has no subtasks. Returns the new pct.
export async function syncPlannerProgressFromSubtasks({ userId, taskId }) {
  if (!userId || !taskId) return null;
  const { data: task } = await supabase
    .from("planner_tasks")
    .select("id, done, priority, points_awarded_for_task")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!task || task.done) return null;
  const { data: subs } = await fetchSubtasks({ plannerTaskId: taskId });
  const { total, pct } = subtaskProgress(subs || []);
  if (!total) return null;

  const newTarget = targetCreditedForTask(false, pct, task.priority);
  const delta = newTarget - (task.points_awarded_for_task || 0);
  await supabase
    .from("planner_tasks")
    .update({ progress: Math.min(99, pct), points_awarded_for_task: newTarget })
    .eq("id", taskId)
    .eq("user_id", userId);
  if (delta !== 0) {
    const { data: row } = await supabase.from("planner_points").select("total_points").eq("user_id", userId).maybeSingle();
    const next = Math.max(0, (row?.total_points ?? 0) + delta);
    await supabase.from("planner_points").upsert(
      { user_id: userId, total_points: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  }
  return pct;
}
