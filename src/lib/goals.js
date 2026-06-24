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

export async function updateGoal({ id, body, status, isPublic, horizon }) {
  if (!id) return { error: { message: "no id" } };
  return supabase.rpc("update_goal", { p_id: id, p_body: body ?? null, p_status: status ?? null, p_is_public: isPublic ?? null, p_horizon: horizon ?? null });
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
