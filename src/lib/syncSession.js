import { supabase } from "../supabase";

export async function createSyncSession(userId, displayName = "", opts = {}) {
  // Generate a 6-char uppercase alphanumeric join code.
  // Use base32-ish padding so it's always exactly 6 chars (avoiding accidental
  // short codes from base36 of small bytes).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit confusable 0/O/1/I
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => chars[b % chars.length]).join("");

  // Allow the caller to set team_id / room_id / visibility / control_mode
  // atomically at INSERT time — avoids a race where teammates query before
  // the follow-up update lands and never see the session in discovery.
  const teamId = opts.teamId ?? null;
  const roomId = opts.roomId ?? null;
  const visibility = opts.visibility ?? (teamId ? "team" : "invite_only");
  const { data: session, error } = await supabase
    .from("sync_sessions")
    .insert({
      leader_id: userId,
      controller_id: userId,
      join_code: code,
      team_id: teamId,
      room_id: roomId,
      visibility,
      control_mode: "leader",
    })
    .select()
    .single();
  if (error) return { error };

  // Add self as participant via the security-definer RPC.
  // This bypasses participant-insert RLS, which can otherwise silently fail
  // for the creator (e.g. policy subqueries that depend on already-being-a-participant).
  const { error: joinErr } = await supabase.rpc("join_sync_session", {
    p_join_code: code,
    p_display_name: displayName,
  });
  if (joinErr) {
    // Best-effort cleanup so we don't leave a session with no participants.
    await supabase.from("sync_sessions").delete().eq("id", session.id);
    return { error: joinErr };
  }

  return { data: session };
}

export async function joinSyncSession(joinCode, displayName = "") {
  const { data, error } = await supabase.rpc("join_sync_session", {
    p_join_code: joinCode.trim().toUpperCase(),
    p_display_name: displayName,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function leaveSyncSession(sessionId) {
  const { data, error } = await supabase.rpc("leave_sync_session", {
    p_session_id: sessionId,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function endSyncSession(sessionId) {
  const { error } = await supabase
    .from("sync_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString(), is_running: false })
    .eq("id", sessionId);
  return { error };
}

export async function fetchSyncSession(sessionId) {
  const { data, error } = await supabase
    .from("sync_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  return { data, error };
}

export async function setSyncParticipantStatus(sessionId, { status, presenceState } = {}) {
  const { data, error } = await supabase.rpc("set_sync_participant_status", {
    p_session_id: sessionId,
    p_status: status ?? null,
    p_presence_state: presenceState ?? null,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function refreshMySyncAvatar() {
  const { error } = await supabase.rpc("refresh_my_sync_avatar");
  return { error };
}

export async function kickSyncParticipant(sessionId, userId) {
  const { data, error } = await supabase.rpc("kick_sync_participant", {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function transferSyncLeader(sessionId, newLeaderId) {
  const { data, error } = await supabase.rpc("transfer_sync_leader", {
    p_session_id: sessionId,
    p_new_leader_id: newLeaderId,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function fetchSyncParticipants(sessionId) {
  const { data, error } = await supabase
    .from("sync_session_participants")
    .select("*")
    .eq("session_id", sessionId)
    .is("left_at", null);
  return { data: data || [], error };
}

function takeControlErrorMessage(error) {
  const code = error?.code || "";
  const status = error?.status || error?.statusCode;
  const message = error?.message || "";

  if (
    code === "PGRST202"
    || status === 404
    || /function.*not found/i.test(message)
  ) {
    return "Take control is not available yet. Apply the Supabase migration 20260611120000_sync_controller.sql (Dashboard → SQL, or run supabase db push).";
  }

  // Prod hit this when 20260611120000 was applied but 20260611150000 was not:
  // take_sync_control updates controller_id, which the guard trigger treated as
  // metadata even though the caller is not yet the controller.
  if (/Only the leader may change session metadata/i.test(message)) {
    return "Take control needs a database update. Apply migration 20260611150000_fix_sync_controller_trigger.sql in Supabase (SQL Editor or supabase db push), then try again.";
  }

  return message || "Could not take control";
}

export async function takeSyncControl(sessionId) {
  const { data, error } = await supabase.rpc("take_sync_control", {
    p_session_id: sessionId,
  });
  if (error) return { error: { message: takeControlErrorMessage(error) } };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function setSyncControlMode(sessionId, mode) {
  const { data, error } = await supabase.rpc("set_sync_control_mode", {
    p_session_id: sessionId,
    p_mode: mode,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function setSyncVisibility(sessionId, visibility) {
  const { data, error } = await supabase.rpc("set_sync_visibility", {
    p_session_id: sessionId,
    p_visibility: visibility,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

// Active team sessions — leaders' display names come from user_settings;
// RLS for those is satisfied by the team_members policy on user_settings.
// Each row carries an `occupants` array so the rooms grid can render
// avatar stacks without a second request per tile.
export async function listActiveTeamSessions(teamId) {
  if (!teamId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("sync_sessions")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active")
    .eq("visibility", "team")
    .order("created_at", { ascending: false });
  if (error || !data?.length) return { data: data || [], error };

  // Join participants client-side.
  const sessionIds = data.map((s) => s.id);
  const { data: parts } = await supabase
    .from("sync_session_participants")
    .select("session_id, user_id")
    .in("session_id", sessionIds)
    .is("left_at", null);

  // Pull profiles for everyone we'll render (every leader + every participant).
  const profileIds = [
    ...new Set([
      ...data.map((s) => s.leader_id),
      ...(parts || []).map((p) => p.user_id),
    ]),
  ];
  const { data: profiles } = profileIds.length
    ? await supabase
        .from("user_settings")
        .select("user_id, name, avatar_url, presence_state")
        .in("user_id", profileIds)
    : { data: [] };
  const profileMap = new Map((profiles || []).map((r) => [r.user_id, r]));

  // Group participants by session for the avatar stack.
  const occupantsBySession = new Map();
  for (const p of (parts || [])) {
    const list = occupantsBySession.get(p.session_id) || [];
    const prof = profileMap.get(p.user_id);
    list.push({
      user_id: p.user_id,
      name: prof?.name || "Team member",
      avatar_url: prof?.avatar_url || "",
      presence_state: prof?.presence_state || "active",
    });
    occupantsBySession.set(p.session_id, list);
  }

  return {
    data: data.map((s) => ({
      ...s,
      leader_name: profileMap.get(s.leader_id)?.name || "Team member",
      leader_avatar: profileMap.get(s.leader_id)?.avatar_url || "",
      participant_count: (occupantsBySession.get(s.id) || []).length,
      occupants: occupantsBySession.get(s.id) || [],
    })),
    error: null,
  };
}

export async function getSyncSessionPreview(joinCode) {
  const { data, error } = await supabase.rpc("get_sync_session_preview", {
    p_join_code: joinCode.trim().toUpperCase(),
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

export async function setUserStatus({ status, presenceState } = {}) {
  const { data, error } = await supabase.rpc("set_user_status", {
    p_status: status ?? null,
    p_presence_state: presenceState ?? null,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}
