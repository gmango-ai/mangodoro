import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

// Realtime presence on `video-call:{roomId}`. Each client in the
// call tracks themselves; everyone else (in the call OR just
// looking at the room view) reads the count and identity of who's
// already there. No DB migration: the channel state is ephemeral,
// which is fine — a call ends when no one is in it anyway.
//
// Mode:
//   "observe" → subscribe + read only; don't track presence
//   "join"    → also broadcast my presence ({ user_id, display_name })
//
// Two clients: an "observer" sees who's in the call before they
// click Join. Once they click and the VideoCall component mounts,
// we flip to "join" mode so others see us.
export function useRoomCallPresence({ roomId, userId, displayName, mode = "observe" }) {
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    if (!roomId || !userId) return;
    const channel = supabase.channel(`video-call:${roomId}`, {
      config: { presence: { key: userId } },
    });

    // Defensive guard against supabase channel-reuse races. The
    // RealtimeClient indexes channels by topic — if a prior effect
    // cycle's cleanup hasn't fully torn down before this one starts
    // (StrictMode double-mount, or fast mode flip), `channel` may be
    // the leftover joined instance. Adding `.on()` listeners then
    // throws "cannot add callbacks after subscribe()". Skipping
    // listener wire-up + the subscribe call leaves the prior
    // listeners active, which is fine for our use case.
    if (channel.state === "joined" || channel.state === "joining") {
      return () => { /* prior cycle owns cleanup */ };
    }

    const refresh = () => {
      const state = channel.presenceState();
      // state is { [key]: [{ user_id, display_name }] }
      const flattened = [];
      for (const arr of Object.values(state)) {
        for (const p of arr) flattened.push(p);
      }
      // De-dupe by user_id in case the same user is in two tabs.
      const seen = new Set();
      const deduped = [];
      for (const p of flattened) {
        if (seen.has(p.user_id)) continue;
        seen.add(p.user_id);
        deduped.push(p);
      }
      setParticipants(deduped);
    };

    channel.on("presence", { event: "sync" }, refresh);
    channel.on("presence", { event: "join" }, refresh);
    channel.on("presence", { event: "leave" }, refresh);

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      if (mode === "join") {
        await channel.track({
          user_id: userId,
          display_name: displayName || "",
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, mode, displayName]);

  const isAnyoneInCall = participants.length > 0;
  const amIInCall = useMemo(
    () => participants.some((p) => p.user_id === userId),
    [participants, userId]
  );
  const others = useMemo(
    () => participants.filter((p) => p.user_id !== userId),
    [participants, userId]
  );

  return { participants, isAnyoneInCall, amIInCall, others };
}
