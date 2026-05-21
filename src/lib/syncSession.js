import { supabase } from "../supabase";

export async function createSyncSession(userId, displayName = "") {
  // Generate a 6-char uppercase alphanumeric join code.
  // Use base32-ish padding so it's always exactly 6 chars (avoiding accidental
  // short codes from base36 of small bytes).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit confusable 0/O/1/I
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => chars[b % chars.length]).join("");

  const { data: session, error } = await supabase
    .from("sync_sessions")
    .insert({ leader_id: userId, join_code: code })
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

export async function setSyncParticipantStatus(sessionId, status) {
  const { data, error } = await supabase.rpc("set_sync_participant_status", {
    p_session_id: sessionId,
    p_status: status,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
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
