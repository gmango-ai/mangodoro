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

export async function listTeamGoals(teamId) {
  if (!teamId) return { data: [], error: null };
  return supabase.rpc("list_team_goals", { p_team_id: teamId });
}
