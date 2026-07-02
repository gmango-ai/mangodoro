import { supabase } from "../supabase";

const PAGE_SIZE = 50;

// chat_messages.user_id references auth.users, not user_settings, so
// we can't embed-join the author profile via PostgREST. Instead we
// fetch the message rows first, then batch-fetch their senders'
// profiles in a single follow-up request and stitch client-side. This
// mirrors how listActiveTeamSessions joins occupants in syncSession.js.
//
// Identity comes from `profiles` (RLS: readable by ANYONE you share a team
// with), NOT user_settings — whose RLS only lets *admins* read co-member rows,
// so a regular member saw every teammate as "Member". `profiles` is kept in sync
// with user_settings by a mirror trigger (migration 20260623200000). Device
// kiosks have no team_members row (so the profiles policy returns nothing for
// them); they fall back to user_settings, where a room-scoped policy grants them
// their room's chat authors (migration 20260625120000).
function authorFromProfile(p) {
  return { user_id: p.user_id, name: p.display_name || "", avatar_url: p.avatar_url || "" };
}

async function hydrateAuthors(rows) {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const byId = new Map();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_url")
    .in("user_id", ids);
  for (const p of profiles || []) byId.set(p.user_id, authorFromProfile(p));
  // Fallback for ids profiles didn't cover (device kiosks).
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("user_id, name, avatar_url")
      .in("user_id", missing);
    for (const s of settings || []) byId.set(s.user_id, s);
  }
  return rows.map((r) => ({ ...r, author: byId.get(r.user_id) || null }));
}

// Returns the most recent page of non-deleted messages, oldest-first
// so the UI can append-and-scroll. Pass `before` (an ISO timestamp) to
// load the next older page.
export async function fetchRecentMessages(roomId, { before } = {}) {
  if (!roomId) return { data: [], error: null };
  let q = supabase
    .from("chat_messages")
    .select("id, room_id, user_id, body, created_at, edited_at, deleted_at, mentioned_user_ids")
    .eq("room_id", roomId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) return { data: [], error };
  const hydrated = await hydrateAuthors((data || []).slice().reverse());
  return { data: hydrated, error: null };
}

// Used by the realtime hook to fill in the author for a single freshly
// inserted message (the realtime payload only carries the row itself).
// profiles first (co-member readable), user_settings fallback for kiosks — see
// hydrateAuthors above for the RLS reasoning.
export async function fetchAuthorProfile(userId) {
  if (!userId) return { data: null, error: null };
  const { data: prof } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (prof) return { data: authorFromProfile(prof), error: null };
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id, name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  return { data, error };
}

export async function sendMessage(roomId, userId, body, mentionedUserIds = []) {
  const trimmed = (body || "").trim();
  if (!trimmed) return { error: { message: "Message is empty" } };
  if (trimmed.length > 4000) return { error: { message: "Message too long" } };
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ room_id: roomId, user_id: userId, body: trimmed, mentioned_user_ids: mentionedUserIds || [] })
    .select()
    .single();
  return { data, error };
}

export async function editMessage(messageId, body) {
  const trimmed = (body || "").trim();
  if (!trimmed) return { error: { message: "Message is empty" } };
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select()
    .single();
  return { data, error };
}

// Soft delete so the realtime UPDATE event propagates the redaction —
// every connected client clears the bubble in place without a separate
// DELETE channel subscription.
export async function deleteMessage(messageId) {
  const { error } = await supabase
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  return { error };
}

// Clear an entire room's chat — soft-deletes every message via a manager-only
// RPC (the table's UPDATE policy is authors-only, so a bulk clear can't go
// through a direct update). Soft delete → the realtime UPDATE events clear every
// connected client's view in place.
export async function clearRoomChat(roomId) {
  if (!roomId) return { error: { message: "No room" } };
  const { error } = await supabase.rpc("clear_room_chat", { p_room_id: roomId });
  return { error };
}
