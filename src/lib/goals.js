import { supabase } from "../supabase";

// First-class goals — a current goal per tag (a department/org_team or an
// individual user) within a team. Whiteboard goal nodes set these; the
// pomodoro / office displays can list them via listTeamGoals.

export async function setGoal({ teamId, ownerType, ownerId, ownerName, ownerColor, body, boardId = null, nodeId = null }) {
  if (!teamId || !ownerType || !ownerId) return { error: { message: "Link the goal to a team or person first." } };
  return supabase.rpc("set_goal", {
    p_team_id: teamId,
    p_owner_type: ownerType,
    p_owner_id: ownerId,
    p_owner_name: ownerName || "",
    p_owner_color: ownerColor || null,
    p_body: body || "",
    p_board: boardId,
    p_node: nodeId,
  });
}

export async function clearGoal({ teamId, ownerType, ownerId }) {
  if (!teamId || !ownerType || !ownerId) return { error: null };
  return supabase.rpc("clear_goal", { p_team_id: teamId, p_owner_type: ownerType, p_owner_id: ownerId });
}

// Clear a specific whiteboard node's goal (each goal node now maps to its own).
export async function clearGoalNode({ boardId, nodeId }) {
  if (!boardId || !nodeId) return { error: null };
  return supabase.rpc("clear_goal_node", { p_board: boardId, p_node: nodeId });
}

export async function listTeamGoals(teamId) {
  if (!teamId) return { data: [], error: null };
  return supabase.rpc("list_team_goals", { p_team_id: teamId });
}

// ── id-based CRUD for the manage surfaces (profile / team) ──
export async function createGoal({ teamId, ownerType, ownerId, ownerName, ownerColor, body, horizon }) {
  if (!teamId || !ownerType || !ownerId) return { error: { message: "Missing team/owner" } };
  return supabase.rpc("create_goal", {
    p_team_id: teamId, p_owner_type: ownerType, p_owner_id: ownerId,
    p_owner_name: ownerName || "", p_owner_color: ownerColor || null, p_body: body || "",
    p_horizon: horizon || "none",
  });
}

export async function updateGoal({ id, body, status, isPublic, horizon, pinned, health }) {
  if (!id) return { error: { message: "no id" } };
  return supabase.rpc("update_goal", {
    p_id: id, p_body: body ?? null, p_status: status ?? null,
    p_is_public: isPublic ?? null, p_horizon: horizon ?? null,
    p_pinned: pinned ?? null, p_health: health ?? null,
  });
}

// ── key results (progress) ──
export async function addKeyResult({ goalId, body, target, unit }) {
  if (!goalId) return { error: { message: "no goal" } };
  return supabase.rpc("add_key_result", { p_goal_id: goalId, p_body: body || "", p_target: target ?? null, p_unit: unit || "" });
}
export async function updateKeyResult({ id, body, target, current, unit }) {
  if (!id) return { error: { message: "no id" } };
  return supabase.rpc("update_key_result", { p_id: id, p_body: body ?? null, p_target: target ?? null, p_current: current ?? null, p_unit: unit ?? null });
}
export async function deleteKeyResult(id) {
  if (!id) return { error: null };
  return supabase.rpc("delete_key_result", { p_id: id });
}
export async function listGoalKeyResults(teamId) {
  if (!teamId) return { data: [], error: null };
  return supabase.rpc("list_goal_key_results", { p_team_id: teamId });
}

// Fraction done [0,1] for one key result. A KR with a positive target counts
// proportionally; one with no/zero target is binary (any progress = done).
export function krFraction(kr) {
  const cur = Number(kr?.current) || 0;
  const tgt = Number(kr?.target);
  if (tgt && tgt > 0) return Math.max(0, Math.min(1, cur / tgt));
  return cur > 0 ? 1 : 0;
}
// Overall goal progress from its KRs → { pct (0-100) | null, total }.
export function goalProgress(krs) {
  const list = krs || [];
  if (!list.length) return { pct: null, total: 0 };
  const avg = list.reduce((s, kr) => s + krFraction(kr), 0) / list.length;
  return { pct: Math.round(avg * 100), total: list.length };
}

export const GOAL_HEALTH = {
  on_track: { label: "On track", color: "#10b981" },
  at_risk: { label: "At risk", color: "#f59e0b" },
  off_track: { label: "Off track", color: "#ef4444" },
};

// Replace a goal's room scoping. Empty array = global (shows in every room).
export async function setGoalRooms({ goalId, roomIds }) {
  if (!goalId) return { error: { message: "no goal" } };
  return supabase.rpc("set_goal_rooms", { p_goal_id: goalId, p_room_ids: roomIds || [] });
}

// (goal_id, room_id) pairs for a team's goals — client maps goal → rooms.
export async function listGoalRooms(teamId) {
  if (!teamId) return { data: [], error: null };
  return supabase.rpc("list_goal_rooms", { p_team_id: teamId });
}

// Horizon labels, shared by the manage UIs + chips.
export const GOAL_HORIZONS = [
  { value: "none", label: "Ongoing", short: "" },
  { value: "week", label: "This week", short: "Week" },
  { value: "month", label: "This month", short: "Month" },
  { value: "quarter", label: "This quarter", short: "Quarter" },
  { value: "year", label: "This year", short: "Year" },
];
export const horizonShort = (h) => GOAL_HORIZONS.find((x) => x.value === h)?.short || "";

export async function deleteGoal(id) {
  if (!id) return { error: null };
  return supabase.rpc("delete_goal", { p_id: id });
}

// Persist an explicit goal order (position = index). Pass the full set of an
// owner's goal ids in the desired order.
export async function reorderGoals(ids) {
  if (!ids || !ids.length) return { error: null };
  return supabase.rpc("reorder_goals", { p_ids: ids });
}

// Move a goal to a different owner (company / department / user) within the
// same org — re-org or elevate a personal goal to a team goal.
export async function reassignGoal({ id, ownerType, ownerId, ownerName, ownerColor }) {
  if (!id || !ownerType || !ownerId) return { error: { message: "Missing target" } };
  return supabase.rpc("reassign_goal", {
    p_id: id, p_owner_type: ownerType, p_owner_id: ownerId,
    p_owner_name: ownerName ?? null, p_owner_color: ownerColor ?? null,
  });
}
