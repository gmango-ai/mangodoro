import { supabase } from "../supabase";

// Generate a 6-char alphanumeric invite code for private rooms.
// Mirrors the sync_session join_code convention so the UI can use the
// same input shape — uppercase, no confusable 0/O/1/I.
const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => INVITE_CHARS[b % INVITE_CHARS.length]).join("");
}

export async function listRooms(teamId) {
  if (!teamId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("rooms")
    .select("id, team_id, name, kind, invite_code, created_by, created_at, archived_at")
    .eq("team_id", teamId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

export async function createRoom(teamId, { name, kind, userId }) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Room name is required" } };
  if (!["department", "meeting", "private"].includes(kind)) {
    return { error: { message: "Invalid room kind" } };
  }
  const invite_code = kind === "private" ? generateInviteCode() : null;
  const { data, error } = await supabase
    .from("rooms")
    .insert({ team_id: teamId, name: trimmed, kind, invite_code, created_by: userId })
    .select()
    .single();
  return { data, error };
}

export async function archiveRoom(roomId) {
  const { error } = await supabase
    .from("rooms")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", roomId);
  return { error };
}

export async function renameRoom(roomId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Room name is required" } };
  const { data, error } = await supabase
    .from("rooms")
    .update({ name: trimmed })
    .eq("id", roomId)
    .select()
    .single();
  return { data, error };
}

export async function resolveRoomByInviteCode(code) {
  const { data, error } = await supabase.rpc("resolve_room_by_invite_code", { p_code: code });
  if (error) return { error };
  return { data };
}

// Returns the active sync_session row for a room (if any). Used when the
// UI needs to decide between "Join this room's running session" and
// "Start a new session here".
export async function fetchRoomActiveSession(roomId) {
  if (!roomId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("sync_sessions")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();
  return { data, error };
}
