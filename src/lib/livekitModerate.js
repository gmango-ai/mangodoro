// Client wrappers for the livekit-moderate edge function. Authority (must be
// the room's sync-session leader) is enforced server-side; these just invoke it.
import { supabase } from "../supabase";

async function moderate(body) {
  const { data, error } = await supabase.functions.invoke("livekit-moderate", { body });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

// Remove a participant from the room's call.
export function kickFromCall(roomId, targetUserId) {
  return moderate({ room_id: roomId, action: "kick", target_user_id: targetUserId });
}

// Server-mute one of a participant's published tracks (pass its trackSid).
export function muteParticipantTrack(roomId, targetUserId, trackSid) {
  return moderate({ room_id: roomId, action: "mute", target_user_id: targetUserId, track_sid: trackSid });
}
