import { supabase } from "../supabase";

// Org projects — a shared, team-scoped list of what people work on. Members read
// the active set; admins curate (RLS-enforced). A stand-in until tasks connect.

export async function listOrgProjects(teamId, { includeArchived = false } = {}) {
  if (!teamId) return [];
  let q = supabase.from("org_projects").select("*").eq("team_id", teamId).order("name");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) { console.warn("listOrgProjects:", error.message); return []; }
  return data || [];
}

export async function createOrgProject({ teamId, name, color }) {
  if (!teamId) return { error: { message: "no team" } };
  return supabase.from("org_projects").insert({ team_id: teamId, name: (name || "").trim(), color: color || "#14b8a6" });
}

export async function updateOrgProject(id, patch) {
  if (!id) return { error: { message: "no id" } };
  return supabase.from("org_projects").update(patch).eq("id", id);
}

export async function archiveOrgProject(id) {
  if (!id) return { error: { message: "no id" } };
  return supabase.from("org_projects").update({ archived_at: new Date().toISOString() }).eq("id", id);
}
