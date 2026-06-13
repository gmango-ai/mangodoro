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
  // Pull room_teams in the same query so the client can decide
  // visibility without an N+1 fetch.
  const { data, error } = await supabase
    .from("rooms")
    .select(`
      id, team_id, name, kind, color, invite_code, created_by, created_at, archived_at,
      layout_x, layout_y, layout_w, layout_h,
      room_teams ( org_team_id )
    `)
    .eq("team_id", teamId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

// v2: goes through the create_room_v2 RPC so the permission model
// (admin / lead / member) is enforced server-side and team-gating
// rows are inserted atomically alongside the room.
export async function createRoomV2(teamId, {
  name, kind, color = "#14b8a6", orgTeamIds = [], layout, userId,
}) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Room name is required" } };
  if (!["department", "meeting", "private"].includes(kind)) {
    return { error: { message: "Invalid room kind" } };
  }
  const invite_code = kind === "private" ? generateInviteCode() : null;
  const { data, error } = await supabase.rpc("create_room_v2", {
    p_team_id: teamId,
    p_name: trimmed,
    p_kind: kind,
    p_org_team_ids: orgTeamIds,
    p_invite_code: invite_code,
    p_layout_x: layout?.x ?? 0,
    p_layout_y: layout?.y ?? 0,
    p_layout_w: layout?.w ?? 4,
    p_layout_h: layout?.h ?? 2,
    p_color: color,
  });
  // The RPC returns just the new room id; callers that need the row
  // can refetch via listRooms.
  return { data: data ? { id: data, name: trimmed, kind, color, invite_code, created_by: userId } : null, error };
}

export async function setRoomColor(roomId, color) {
  const { error } = await supabase.rpc("set_room_color", {
    p_room_id: roomId,
    p_color: color,
  });
  return { error };
}

export async function updateRoomLayout(roomId, { x, y, w, h }) {
  const { error } = await supabase.rpc("update_room_layout", {
    p_room_id: roomId,
    p_x: x,
    p_y: y,
    p_w: w,
    p_h: h,
  });
  return { error };
}

export async function updateRoomGating(roomId, orgTeamIds) {
  const { error } = await supabase.rpc("update_room_gating", {
    p_room_id: roomId,
    p_org_team_ids: orgTeamIds || [],
  });
  return { error };
}

export async function archiveRoomV2(roomId) {
  const { error } = await supabase.rpc("archive_room_v2", { p_room_id: roomId });
  return { error };
}

export async function renameRoomV2(roomId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Room name is required" } };
  const { error } = await supabase.rpc("rename_room", {
    p_room_id: roomId,
    p_name: trimmed,
  });
  return { error };
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
