import { supabase } from "../supabase";

// First-class person identity (see migration 20260623200000). Readable for
// anyone you share a team with (RLS). Org-scoped attrs (role, presence, status)
// still come from team data; this is the stable global identity.

export async function getProfile(userId) {
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  return data || null;
}

async function fetchProfilesMap(ids, columns) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  const { data } = await supabase.from("profiles").select(columns).in("user_id", list);
  const map = {};
  (data || []).forEach((p) => { map[p.user_id] = p; });
  return map;
}

export async function getProfiles(ids) {
  return fetchProfilesMap(ids, "*");
}

// Lean identity fetch — for callers that only render name + avatar and don't
// need the schedule/OOO/availability columns.
export async function getProfilesBasic(ids) {
  return fetchProfilesMap(ids, "user_id, display_name, avatar_url");
}

export async function updateMyProfile(userId, patch) {
  if (!userId) return { error: { message: "no user" } };
  const { error } = await supabase
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return { error };
}
