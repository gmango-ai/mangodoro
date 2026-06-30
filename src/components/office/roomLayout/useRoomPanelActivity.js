import { useEffect, useState } from "react";
import { supabase } from "../../../supabase";

// Activity for the room's CLOSED panels, so the header toggles can show what's
// happening without opening each one:
//   • video      — how many people are in the call (call presence)
//   • whiteboard — how many people are editing the linked board (board presence)
//   • chat       — unread messages since you last had chat open
//
// Each signal is read only while its panel is CLOSED — the open panel's own
// component owns that subscription, and skipping ours avoids a same-topic
// channel-reuse race (and a redundant subscription). We OBSERVE presence
// (never track), so we don't add ourselves to any count.
export function useRoomPanelActivity({
  roomId, userId, whiteboardId,
  videoOpen, chatOpen, whiteboardOpen,
}) {
  // ── people in the call ──
  const [callCount, setCallCount] = useState(0);
  useEffect(() => {
    if (!roomId || !userId || videoOpen) { setCallCount(0); return undefined; }
    const channel = supabase.channel(`video-call:${roomId}`, { config: { presence: { key: userId } } });
    const refresh = () => {
      const state = channel.presenceState();
      const ids = new Set();
      for (const arr of Object.values(state)) for (const p of arr) if (p?.user_id) ids.add(p.user_id);
      setCallCount(ids.size);
    };
    if (channel.state === "joined" || channel.state === "joining") {
      refresh();
      return () => { /* prior cycle owns it */ };
    }
    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, userId, videoOpen]);

  // ── people editing the whiteboard ── (board presence keyed per editor tab)
  const [wbCount, setWbCount] = useState(0);
  useEffect(() => {
    if (!whiteboardId || whiteboardOpen || !userId) { setWbCount(0); return undefined; }
    const channel = supabase.channel(`wb:${whiteboardId}`, { config: { presence: { key: `peek-${userId}` } } });
    if (channel.state === "joined" || channel.state === "joining") return () => { /* prior cycle owns it */ };
    const refresh = () => { setWbCount(Object.keys(channel.presenceState()).length); };
    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [whiteboardId, whiteboardOpen, userId]);

  // ── unread chat ── messages from others since you last had chat open.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!roomId || !userId) { setUnread(0); return undefined; }
    const seenKey = `ql_room_chat_seen_${roomId}`;
    if (chatOpen) {
      // Chat is open → nothing is unread. Stamp "seen = now" on cleanup (when
      // you close it / leave), so messages that arrived WHILE it was open count
      // as seen, and only later ones are unread.
      setUnread(0);
      return () => { try { localStorage.setItem(seenKey, new Date().toISOString()); } catch { /* */ } };
    }
    let alive = true;
    let lastSeen = null;
    try { lastSeen = localStorage.getItem(seenKey); } catch { /* */ }
    if (!lastSeen) {
      // First time we've tracked this room → treat existing history as seen.
      lastSeen = new Date().toISOString();
      try { localStorage.setItem(seenKey, lastSeen); } catch { /* */ }
    }
    supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .gt("created_at", lastSeen)
      .is("deleted_at", null)
      .neq("user_id", userId)
      .then(({ count }) => { if (alive) setUnread(count || 0); });
    const channel = supabase
      .channel(`room-chat-unread:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const m = payload.new;
          if (alive && m?.user_id !== userId && !m?.deleted_at) setUnread((n) => n + 1);
        },
      )
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [roomId, userId, chatOpen]);

  return {
    video: callCount,
    whiteboard: wbCount,
    chat: unread,
  };
}
