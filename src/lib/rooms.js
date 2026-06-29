import { supabase } from "../supabase";

export async function listRooms(teamId) {
  if (!teamId) return { data: [], error: null };
  // Pull room_teams in the same query so the client can decide
  // visibility without an N+1 fetch.
  const { data, error } = await supabase
    .from("rooms")
    .select(`
      id, team_id, name, kind, color, entry_policy, pin_policy, created_by, created_at, archived_at,
      layout_x, layout_y, layout_w, layout_h, max_duration_minutes,
      room_teams ( org_team_id )
    `)
    .eq("team_id", teamId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

// v2 (updated 2026-06-27): kinds are `general` (was `department`),
// `meeting`, and `private`. Private rooms are created with an enforced
// `code` entry policy and a server-seeded shareable PIN (viewable in Room
// settings) — they're locked but immediately usable. Other kinds default
// to the `open` policy. Meeting rooms accept a maxDurationMinutes that
// auto-closes the sync_session via the server-side sweeper. Layout coords
// are optional; when omitted the server scans for the first open w×h slot
// in the team's grid and uses that.
export async function createRoomV2(teamId, {
  name, kind, color = "#14b8a6", orgTeamIds = [], layout, maxDurationMinutes, userId,
}) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { error: { message: "Room name is required" } };
  if (!["general", "meeting", "private"].includes(kind)) {
    return { error: { message: "Invalid room kind" } };
  }
  if (maxDurationMinutes != null && kind !== "meeting") {
    return { error: { message: "Only meeting rooms can have a max duration" } };
  }
  const { data, error } = await supabase.rpc("create_room_v2", {
    p_team_id: teamId,
    p_name: trimmed,
    p_kind: kind,
    p_org_team_ids: orgTeamIds,
    // null layout coords → server auto-places in the first open cell.
    p_layout_x: layout?.x ?? null,
    p_layout_y: layout?.y ?? null,
    p_layout_w: layout?.w ?? 4,
    p_layout_h: layout?.h ?? 2,
    p_color: color,
    p_max_duration_minutes: maxDurationMinutes ?? null,
  });
  return {
    data: data
      ? {
          id: data, name: trimmed, kind, color, created_by: userId,
          entry_policy: kind === "private" ? "code" : "open",
        }
      : null,
    error,
  };
}

export async function setRoomColor(roomId, color) {
  const { error } = await supabase.rpc("set_room_color", {
    p_room_id: roomId,
    p_color: color,
  });
  return { error };
}

// Meeting-only. Pass `null` for "no limit". Server enforces both the
// meeting-only invariant and the "admin or creator" permission check.
export async function setRoomMaxDuration(roomId, minutes) {
  const { error } = await supabase.rpc("set_room_max_duration", {
    p_room_id: roomId,
    p_minutes: minutes == null ? null : Number(minutes),
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

// ── Room privacy (entry policy + access code) ──────────────────────
// `entry_policy` is a non-secret column on the room ('open' | 'code').
// The code itself lives in room_secrets, readable only by the room's
// managers (owner / admin / gating-team lead) via RLS.

export async function setRoomEntryPolicy(roomId, policy) {
  const { error } = await supabase.rpc("set_room_entry_policy", {
    p_room_id: roomId,
    p_policy: policy,
  });
  return { error };
}

// Who may pin a participant into everyone's view:
// 'admins' | 'leaders' | 'both' | 'everyone'. Server enforces the manager check.
export async function setRoomPinPolicy(roomId, policy) {
  const { error } = await supabase.rpc("set_room_pin_policy", {
    p_room_id: roomId,
    p_policy: policy,
  });
  return { error };
}

// Pass null / "" to clear the code. Server enforces the manager check and
// stores the PIN uppercased + trimmed.
export async function setRoomAccessCode(roomId, code) {
  const { error } = await supabase.rpc("set_room_access_code", {
    p_room_id: roomId,
    p_code: code ?? "",
  });
  return { error };
}

// Returns the room's current PIN, or null if none set / not permitted.
// RLS on room_secrets returns a row only to the room's managers, so a
// non-manager silently gets null.
export async function getRoomAccessCode(roomId) {
  if (!roomId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("room_secrets")
    .select("code")
    .eq("room_id", roomId)
    .maybeSingle();
  return { data: data?.code ?? null, error };
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
