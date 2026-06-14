import { supabase } from "../supabase";
import { uploadTeamSound, deleteCustomSound } from "./customSound";

// CRUD for team-shared pomodoro sounds.
//
// Each row references a file in the pomodoro-sounds bucket under
// team/<teamId>/. RLS limits inserts/updates/deletes to team admins.
// The preset id rendered into the timer's sound picker is `tsound:<row.id>`.

export async function listTeamSounds(teamId) {
  if (!teamId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("team_sounds")
    .select("id, team_id, name, url, path, created_by, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

export async function addTeamSound({ teamId, file, userId, name }) {
  if (!teamId) return { error: { message: "No team selected" } };
  if (!file) return { error: { message: "No file selected" } };

  const up = await uploadTeamSound(file, teamId);
  if (up.error) return { error: up.error };

  const friendlyName = (name || file.name || "Team sound").trim().slice(0, 80);
  const { data, error } = await supabase
    .from("team_sounds")
    .insert({
      team_id: teamId,
      name: friendlyName,
      url: up.data.url,
      path: up.data.path,
      created_by: userId,
    })
    .select()
    .single();
  if (error) {
    // Roll back the orphaned upload so we don't leak storage.
    await deleteCustomSound(up.data.path);
    return { error };
  }
  return { data };
}

export async function renameTeamSound(soundId, name) {
  const clean = (name || "").trim().slice(0, 80);
  if (!clean) return { error: { message: "Name can't be empty" } };
  const { data, error } = await supabase
    .from("team_sounds")
    .update({ name: clean })
    .eq("id", soundId)
    .select()
    .single();
  return { data, error };
}

export async function removeTeamSound(sound) {
  if (!sound?.id) return { error: { message: "Missing sound" } };
  // Drop the row first; if the cascade succeeds we then drop storage.
  // Other order would leave dangling rows pointing at deleted files.
  const { error } = await supabase.from("team_sounds").delete().eq("id", sound.id);
  if (error) return { error };
  if (sound.path) await deleteCustomSound(sound.path);
  return { error: null };
}
