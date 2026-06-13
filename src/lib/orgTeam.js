import { supabase } from "../supabase";

// CRUD helpers for org_teams — the "sub-team" / department layer that
// lives inside an org. The DB tables are `org_teams` and
// `org_team_members`; the UI calls them "teams" inside an org.

export async function listOrgTeams(orgId) {
  if (!orgId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("org_teams")
    .select("id, org_id, name, color, created_by, created_at, archived_at")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("name", { ascending: true });
  return { data: data || [], error };
}

export async function createOrgTeam(orgId, { name, color = "#14b8a6", userId }) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Team name is required" } };
  if (!userId) return { error: { message: "Not signed in" } };
  const { data, error } = await supabase
    .from("org_teams")
    .insert({ org_id: orgId, name: trimmed, color, created_by: userId })
    .select()
    .single();
  return { data, error };
}

export async function renameOrgTeam(orgTeamId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Team name is required" } };
  const { data, error } = await supabase
    .from("org_teams")
    .update({ name: trimmed })
    .eq("id", orgTeamId)
    .select()
    .single();
  return { data, error };
}

export async function setOrgTeamColor(orgTeamId, color) {
  const { data, error } = await supabase
    .from("org_teams")
    .update({ color })
    .eq("id", orgTeamId)
    .select()
    .single();
  return { data, error };
}

export async function archiveOrgTeam(orgTeamId) {
  const { error } = await supabase
    .from("org_teams")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", orgTeamId);
  return { error };
}

// Returns the full membership list for an org_team. Org members can
// see this; org admins see it for every team in the org.
export async function listOrgTeamMembers(orgTeamId) {
  if (!orgTeamId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("org_team_members")
    .select("user_id, role, joined_at")
    .eq("org_team_id", orgTeamId);
  return { data: data || [], error };
}

export async function addOrgTeamMember(orgTeamId, userId, role = "member") {
  const { error } = await supabase
    .from("org_team_members")
    .insert({ org_team_id: orgTeamId, user_id: userId, role });
  return { error };
}

export async function removeOrgTeamMember(orgTeamId, userId) {
  const { error } = await supabase
    .from("org_team_members")
    .delete()
    .eq("org_team_id", orgTeamId)
    .eq("user_id", userId);
  return { error };
}

export async function setOrgTeamMemberRole(orgTeamId, userId, role) {
  const { error } = await supabase
    .from("org_team_members")
    .update({ role })
    .eq("org_team_id", orgTeamId)
    .eq("user_id", userId);
  return { error };
}

// Convenience: which of the active org's teams is the given user
// already in. Used to drive the chip checkbox state in admin UI.
export async function listMyOrgTeams(orgId, userId) {
  if (!orgId || !userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("org_team_members")
    .select("org_team_id, role, org_teams!inner(org_id)")
    .eq("user_id", userId)
    .eq("org_teams.org_id", orgId);
  return { data: data || [], error };
}
