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

// A user's work summary (today/week/month/streak/avg-start) — RPC-gated to self
// or a team admin of the target; returns null when not permitted.
export async function getUserWorkSummary(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc("get_user_work_summary", { p_user_id: userId });
  if (error) return null; // not permitted / no row
  return data;
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
