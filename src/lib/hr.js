import { supabase } from "../supabase";

// Admin-only: update a single member's HR fields. Null preserves the
// existing value, so the caller can update one field at a time without
// reading-then-writing.
export async function setMemberHR(teamId, userId, { classification, hourlyRate, weeklyTargetHours } = {}) {
  const { error } = await supabase.rpc("set_member_hr", {
    p_team_id: teamId,
    p_user_id: userId,
    p_classification: classification ?? null,
    p_hourly_rate: hourlyRate ?? null,
    p_weekly_target_hours: weeklyTargetHours ?? null,
  });
  return { error };
}

// Admin-only: set (or clear, with null) a member's manager. Drives the org
// chart's reporting-tree view (team_members.manager_id).
export async function setMemberManager(teamId, userId, managerId) {
  const { error } = await supabase.rpc("set_member_manager", {
    p_team_id: teamId,
    p_user_id: userId,
    p_manager_id: managerId || null,
  });
  return { error };
}

// Current ISO week minutes for the caller, summed from the entries
// table. Used by SalaryClockCard for the weekly-progress bar.
export async function fetchMyWeekMinutes() {
  const { data, error } = await supabase.rpc("get_my_week_minutes");
  if (error) return { error };
  return { data: typeof data === "number" ? data : 0 };
}
