import { supabase } from "../supabase";

export const RETRO_LANES = [
  { key: "celebrate",  label: "Celebrate",       hint: "Wins, shoutouts" },
  { key: "went_well",  label: "What went well",  hint: "Things to keep doing" },
  { key: "to_improve", label: "To improve",      hint: "Stuff that bugged us" },
  { key: "next_week",  label: "Next week",       hint: "Carry-over + focus" },
];

// Returns the current week's retro for the team, creating it on first
// access. RPC verifies team membership.
export async function getOrCreateCurrentRetro(teamId) {
  const { data: retroId, error } = await supabase.rpc("get_or_create_current_retro", {
    p_team_id: teamId,
  });
  if (error) return { error };
  const { data, error: fetchErr } = await supabase
    .from("retros")
    .select("*")
    .eq("id", retroId)
    .single();
  if (fetchErr) return { error: fetchErr };
  return { data };
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
