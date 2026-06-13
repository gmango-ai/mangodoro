import { supabase } from "../supabase";

export const RETRO_LANES = [
  { key: "celebrate",  label: "Celebrate",       hint: "Wins, shoutouts" },
  { key: "went_well",  label: "What went well",  hint: "Things to keep doing" },
  { key: "to_improve", label: "To improve",      hint: "Stuff that bugged us" },
  { key: "next_week",  label: "Next week",       hint: "Carry-over + focus" },
];

// Returns the current week's retro for (team, department), creating it
// on first access. Department defaults to '' which means the team-wide
// retro (used as fallback for teams without curated departments).
export async function getOrCreateCurrentRetro(orgId, orgTeamId = null) {
  const { data: retroId, error } = await supabase.rpc("get_or_create_current_retro_for_team", {
    p_org_id: orgId,
    p_org_team_id: orgTeamId,
  });
  if (error) return { error };
  const { data, error: fetchErr } = await supabase
    .from("retros").select("*").eq("id", retroId).single();
  if (fetchErr) return { error: fetchErr };
  return { data };
}

// Fetch every retro for the current ISO week for the given team. Used
// by /pomodoro to stack multiple department goals in the banner, and
// could power a "compare goals" view later.
export async function listCurrentWeekRetros(teamId) {
  if (!teamId) return { data: [], error: null };
  const today = new Date();
  // ISO Monday-start in the client's local timezone — matches what the
  // RPC computes server-side closely enough for the banner.
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day - 1));
  const weekStart = monday.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("retros")
    .select("*")
    .eq("team_id", teamId)
    .eq("week_start", weekStart);
  return { data: data || [], error };
}

export async function listRetroCards(retroId) {
  const { data, error } = await supabase
    .from("retro_cards")
    .select("*")
    .eq("retro_id", retroId)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

export async function createRetroCard(retroId, { lane, body, authorId }) {
  const trimmed = (body || "").trim();
  if (!trimmed) return { error: { message: "Card can't be empty." } };
  if (trimmed.length > 500) return { error: { message: "Card too long (max 500 chars)." } };
  const { data, error } = await supabase
    .from("retro_cards")
    .insert({ retro_id: retroId, lane, body: trimmed, author_id: authorId })
    .select()
    .single();
  return { data, error };
}

export async function updateRetroCard(cardId, body) {
  const trimmed = (body || "").trim();
  if (!trimmed) return { error: { message: "Card can't be empty." } };
  if (trimmed.length > 500) return { error: { message: "Card too long (max 500 chars)." } };
  const { data, error } = await supabase
    .from("retro_cards")
    .update({ body: trimmed })
    .eq("id", cardId)
    .select()
    .single();
  return { data, error };
}

export async function deleteRetroCard(cardId) {
  const { error } = await supabase
    .from("retro_cards")
    .delete()
    .eq("id", cardId);
  return { error };
}

export async function setRetroGoal(retroId, goal) {
  const { error } = await supabase.rpc("set_retro_goal", {
    p_retro_id: retroId,
    p_goal: goal ?? "",
  });
  return { error };
}

// Returns every retro the caller can see for a team — used by /retros
// to list current-week and history.
export async function listTeamRetros(teamId) {
  if (!teamId) return { data: [], error: null };
  const { data, error } = await supabase.rpc("list_team_retros", { p_team_id: teamId });
  return { data: data || [], error };
}

// Fetch one retro by id (no lazy-create). Used when navigating to
// /retros/:retroId.
export async function fetchRetroById(retroId) {
  if (!retroId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("retros")
    .select("*")
    .eq("id", retroId)
    .maybeSingle();
  return { data, error };
}

// Participants for a retro — combines team members and external guests
// via the get_retro_participants RPC.
export async function listRetroParticipants(retroId) {
  if (!retroId) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_retro_participants", { p_retro_id: retroId });
  return { data: data || [], error };
}

export async function getRetroInvitePreview(code) {
  const { data, error } = await supabase.rpc("get_retro_invite_preview", { p_code: code });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function joinRetroByCode(code, displayName) {
  const { data, error } = await supabase.rpc("join_retro_by_code", {
    p_code: code,
    p_display_name: displayName,
  });
  if (error) return { error };
  return { data };
}

// Local helper — read-only flag derived from week_start.
export function isRetroCurrentWeek(retro) {
  if (!retro?.week_start) return false;
  // Match the server's ISO Monday-start computation in the user's
  // local timezone. Off-by-one across DST boundaries is harmless;
  // the server is the source of truth and will reject writes.
  const today = new Date();
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day - 1));
  return monday.toISOString().slice(0, 10) === retro.week_start;
}

// Admin-only: open or close a retro. Closed retros become read-only;
// re-opening lets the team edit cards/goal again.
export async function setRetroLive(retroId, isLive) {
  const { error } = await supabase.rpc("set_retro_live", {
    p_retro_id: retroId,
    p_is_live: isLive,
  });
  return { error };
}

// Helper: format an ISO week_start date as a human-friendly range.
// e.g. "Jun 8–14" or "Jun 30–Jul 6".
export function formatRetroWeek(weekStart) {
  if (!weekStart) return "";
  const start = new Date(weekStart + "T12:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const month = (d) => d.toLocaleDateString("en-US", { month: "short" });
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${month(start)} ${start.getDate()}–${end.getDate()}`
    : `${month(start)} ${start.getDate()}–${month(end)} ${end.getDate()}`;
}
