import { supabase } from "../supabase";

// The team-visible "who's working now" signal. A user's own row mirrors their
// private clock (AppContext clockIn) via PresenceSync; teammates read the set.

// Upsert my work status. clockedInAt null = clear (clocked out).
export async function setWorkStatus({ userId, teamId = null, clockedInAt, onBreak = false, task = null }) {
  if (!userId) return { error: { message: "no user" } };
  return supabase.from("work_status").upsert(
    {
      user_id: userId,
      team_id: teamId,
      clocked_in_at: clockedInAt || null,
      on_break: !!onBreak,
      task: task || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

// Everyone currently clocked in that I'm allowed to see (RLS = own + teammates).
export async function listClockedIn() {
  const { data, error } = await supabase
    .from("work_status")
    .select("user_id, team_id, clocked_in_at, on_break, task, updated_at")
    .not("clocked_in_at", "is", null);
  if (error) { console.warn("listClockedIn:", error.message); return []; }
  return data || [];
}
