// Shared task mutations — the "edit once, syncs everywhere" write path.
//
// Every surface (Tasks timeline, the shared editor, calendar, pomodoro focus)
// routes writes through here instead of duplicating logic. Planner gamification
// (points on done/priority/progress) is owned here — extracted from the old
// PlannerPage so it survives the planner's retirement. Personal tasks route to
// the lightweight calendar helpers.
//
// Functions return Supabase-style `{ data?, error }` (plus, for gamified
// updates, a `patch` of normalized fields + `totalPoints`) so callers can apply
// optimistic state without re-reading.

import { supabase } from "../../supabase";
import {
  updatePlannerTaskFields, deletePlannerTask,
  updatePersonalTaskFields, deletePersonalTask,
} from "../calendar";

// ── gamification math (mirrors the old PlannerPage / plannerTasks.js) ───────
export function pointsForComplete(priority) {
  const p = Math.min(3, Math.max(0, priority | 0));
  return 10 + p * 5;
}
function clampProgress(n) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}
function targetCreditedForTask(done, progress, priority) {
  const max = pointsForComplete(priority);
  if (done) return max;
  return Math.floor((max * Math.min(99, clampProgress(progress))) / 100);
}

async function adjustPoints(userId, delta) {
  if (!userId || !delta) return undefined;
  const { data: row } = await supabase.from("planner_points").select("total_points").eq("user_id", userId).maybeSingle();
  const next = Math.max(0, (row?.total_points ?? 0) + delta);
  await supabase.from("planner_points").upsert(
    { user_id: userId, total_points: next, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return next;
}

/**
 * Apply a done/priority/progress change to a planner task, keeping
 * points_awarded_for_task + the planner_points total in sync. Rolls the point
 * delta back if the row update fails. Returns `{ error, patch, totalPoints }`
 * where patch holds normalized (camelCase) fields for optimistic state.
 */
export async function applyPlannerGamification({ userId, task, partial }) {
  if (!userId) return { error: { message: "no user" } };
  let done = partial.done !== undefined ? partial.done : task.done;
  const priority = partial.priority !== undefined ? Math.min(3, Math.max(0, partial.priority | 0)) : task.priority;
  let progress = task.progress;

  if (partial.done === true) { done = true; progress = 100; }
  else if (partial.done === false) { done = false; progress = partial.progress !== undefined ? clampProgress(partial.progress) : 99; }
  else if (partial.progress !== undefined) { progress = clampProgress(partial.progress); if (!done) progress = Math.min(99, progress); }
  if (done) progress = 100; else progress = Math.min(99, progress);

  const newTarget = targetCreditedForTask(done, progress, priority);
  const delta = newTarget - (task.pointsAwardedForTask || 0);
  const dbPatch = { done, progress, priority, points_awarded_for_task: newTarget };
  if (done) dbPatch.in_progress = false;

  let totalPoints;
  if (delta !== 0) totalPoints = await adjustPoints(userId, delta);
  const { error } = await supabase.from("planner_tasks").update(dbPatch).eq("id", task.id).eq("user_id", userId);
  if (error) {
    if (delta !== 0) await adjustPoints(userId, -delta);
    return { error };
  }
  return {
    error: null,
    patch: { done, progress, priority, pointsAwardedForTask: newTarget, inProgress: done ? false : task.inProgress },
    totalPoints,
  };
}

// ── status / done / priority / progress (kind-aware) ────────────────────────
// `done` stays the source of truth for grouping/gamification; `status` mirrors
// it (status 'done' ⇔ done true) with an extra 'doing' state in between.
export async function setTaskDone({ userId, task, done }) {
  const status = done ? "done" : "todo";
  if (task.kind === "personal") {
    const { error } = await updatePersonalTaskFields(task.id, { done, done_at: done ? new Date().toISOString() : null, status });
    return error ? { error } : { error: null, patch: { done, status } };
  }
  const g = await applyPlannerGamification({ userId, task, partial: { done } });
  if (g.error) return g;
  await supabase.from("planner_tasks").update({ status }).eq("id", task.id).eq("user_id", userId);
  return { ...g, patch: { ...g.patch, status } };
}

// Set the kanban status. Only runs gamification when `done` actually flips
// (so todo↔doing never disturbs progress/points).
export async function setTaskStatus({ userId, task, status }) {
  const done = status === "done";
  const doneChanged = done !== task.done;
  if (task.kind === "personal") {
    const patch = { status };
    if (doneChanged) { patch.done = done; patch.done_at = done ? new Date().toISOString() : null; }
    const { error } = await updatePersonalTaskFields(task.id, patch);
    return error ? { error } : { error: null, patch: { status, done } };
  }
  let extra = {};
  if (doneChanged) {
    const g = await applyPlannerGamification({ userId, task, partial: { done } });
    if (g.error) return g;
    extra = { ...g.patch, totalPoints: g.totalPoints };
  }
  const { error } = await supabase.from("planner_tasks").update({ status }).eq("id", task.id).eq("user_id", userId);
  if (error) return { error };
  return { error: null, patch: { status, done, ...extra } };
}
export function setTaskPriority({ userId, task, priority }) {
  return applyPlannerGamification({ userId, task, partial: { priority } });
}
export function setTaskProgress({ userId, task, progress }) {
  return applyPlannerGamification({ userId, task, partial: { progress } });
}

// ── non-gamified field edits (title, due, deadline, labels, notes, project) ─
export async function updateTaskFields({ task, fields }) {
  const patch = {};
  if (fields.title !== undefined) patch.title = fields.title.trim();
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate || null;
  if (fields.deadline !== undefined) patch.deadline = fields.deadline === "hard" ? "hard" : "soft";
  if (fields.labels !== undefined) patch.labels = fields.labels;
  if (task.kind === "personal") return updatePersonalTaskFields(task.id, patch);
  // planner-only columns
  if (fields.plannerDate !== undefined) patch.planner_date = fields.plannerDate || null;
  if (fields.notes !== undefined) patch.notes = fields.notes;
  if (fields.projectId !== undefined) patch.project_id = fields.projectId || null;
  return updatePlannerTaskFields(task.id, patch);
}

// ── focus (planner only): one in_progress task at a time per user ───────────
export async function setFocus({ userId, taskId }) {
  await supabase.from("planner_tasks").update({ in_progress: false }).eq("user_id", userId).eq("in_progress", true);
  return supabase.from("planner_tasks").update({ in_progress: true }).eq("id", taskId).eq("user_id", userId);
}
export async function clearFocus({ userId, taskId }) {
  return supabase.from("planner_tasks").update({ in_progress: false }).eq("id", taskId).eq("user_id", userId);
}

// ── create / delete ─────────────────────────────────────────────────────────
// Timeline tasks are organized by due_date; new ones are planner tasks with a
// due_date (or null → Someday shelf) and no planner_date (the day-planner is
// retired), so they never clutter a legacy day bucket.
export async function createTask({ userId, title, dueDate = null, priority = 0, labels = [], deadline = "soft" }) {
  const row = {
    user_id: userId,
    title: title.trim(),
    done: false,
    in_progress: false,
    sort_order: 0,
    priority,
    progress: 0,
    points_awarded_for_task: 0,
    due_date: dueDate,
    planner_date: null,
    deadline,
    labels,
  };
  return supabase.from("planner_tasks").insert(row).select().single();
}

export async function deleteTask({ task }) {
  return task.kind === "personal" ? deletePersonalTask(task.id) : deletePlannerTask(task.id);
}

// Archive / unarchive — hide from normal views without deleting.
export async function setArchived({ task, archived }) {
  const { error } = task.kind === "personal"
    ? await updatePersonalTaskFields(task.id, { archived })
    : await updatePlannerTaskFields(task.id, { archived });
  return error ? { error } : { error: null, patch: { archived } };
}
