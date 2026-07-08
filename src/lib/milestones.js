import { supabase } from "../supabase";

// Milestones — first-class "deadline / big date" items (personal or team-shared).
// RLS (20260708130000): read = creator or team-scoped for members; write = creator/admin.

export async function listMilestonesInRange(teamId, startDate, endDate) {
  if (!teamId) return { data: [] };
  return supabase
    .from("milestones")
    .select("id, team_id, title, description, milestone_date, milestone_time, color, scope, link_type, link_id, created_by")
    .eq("team_id", teamId)
    .gte("milestone_date", startDate)
    .lte("milestone_date", endDate)
    .order("milestone_date");
}

export async function createMilestone({ teamId, title, description, date, time, color, scope = "personal" }) {
  return supabase
    .from("milestones")
    .insert({
      team_id: teamId,
      title,
      description: description || null,
      milestone_date: date,
      milestone_time: time || null,
      color: color || null,
      scope,
    })
    .select()
    .single();
}

export async function updateMilestone(id, patch) {
  return supabase.from("milestones").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function deleteMilestone(id) {
  return supabase.from("milestones").delete().eq("id", id);
}
