import { supabase } from "../supabase";

export async function createSyncSession(userId, displayName = "") {
  // Generate 6-char uppercase join code
  const code = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(36))
    .join("")
    .toUpperCase()
    .slice(0, 6);

  const { data: session, error } = await supabase
    .from("sync_sessions")
    .insert({ leader_id: userId, join_code: code })
    .select()
    .single();
  if (error) return { error };

  // Add self as participant
  await supabase.from("sync_session_participants").insert({
    session_id: session.id,
    user_id: userId,
    display_name: displayName,
  });

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

export async function leaveSyncSession(sessionId, userId) {
  const { error } = await supabase
    .from("sync_session_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("user_id", userId);
  return { error };
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

export async function fetchSyncParticipants(sessionId) {
  const { data, error } = await supabase
    .from("sync_session_participants")
    .select("*")
    .eq("session_id", sessionId)
    .is("left_at", null);
  return { data: data || [], error };
}
