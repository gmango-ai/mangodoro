import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import {
  fetchRecentMessages,
  fetchAuthorProfile,
  sendMessage,
  editMessage,
  deleteMessage,
  getRoomChannelId,
  fetchChannelMessages,
  sendChannelMessage,
  editChannelMessage,
  deleteChannelMessage,
} from "./chatMessages";
import { playMessage } from "./uiSounds";
import { markConversationRead } from "./messages";

// React hook: the room's chat history + live updates.
//
// Unified backend (Stage 2): a GENERAL room's chat IS its Messages channel, so
// we read/write dm_messages via the room's channel. Non-general rooms (and any
// client running before the migration lands) resolve no channel and stay on the
// legacy chat_messages table — the panel's message shape is identical either
// way (sender_id is mapped to user_id in the channel path).
//
// convId: undefined = still resolving · null = legacy chat_messages · string =
// the room's channel (dm_messages).
export function useRoomChat(roomId, userId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [convId, setConvId] = useState(undefined);

  const authorCacheRef = useRef(new Map());
  const cacheAuthors = (rows) => {
    for (const r of rows) if (r.author) authorCacheRef.current.set(r.user_id, r.author);
  };

  // Resolve the room's channel first (general rooms only). null → legacy.
  useEffect(() => {
    if (!roomId) { setConvId(null); return undefined; }
    let alive = true;
    setConvId(undefined);
    getRoomChannelId(roomId).then((cid) => { if (alive) setConvId(cid ?? null); });
    return () => { alive = false; };
  }, [roomId]);

  // Initial page — once the mode (channel vs legacy) is known.
  useEffect(() => {
    if (!roomId || convId === undefined) return undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    const p = convId ? fetchChannelMessages(convId) : fetchRecentMessages(roomId);
    p.then(({ data, error: err }) => {
      if (!alive) return;
      if (err) setError(err);
      cacheAuthors(data);
      setMessages(data);
      setLoading(false);
      // Viewing the room chat counts as reading its unified channel, so the
      // Messages inbox doesn't badge history you've already seen here.
      if (convId && userId) markConversationRead(convId, userId, "channel");
    });
    return () => { alive = false; };
  }, [roomId, convId, userId]);

  // Realtime — subscribe to the right table/filter for the mode.
  useEffect(() => {
    if (!roomId || convId === undefined) return undefined;
    const useChannel = !!convId;
    const table = useChannel ? "dm_messages" : "chat_messages";
    const filter = useChannel ? `conversation_id=eq.${convId}` : `room_id=eq.${roomId}`;
    // Channel rows carry sender_id; normalise to the panel's user_id shape.
    const norm = (row) => (useChannel && row ? { ...row, user_id: row.sender_id } : row);
    const channel = supabase.channel(`roomchat:${useChannel ? convId : roomId}`);

    channel.on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, async (payload) => {
      const row = norm(payload.new);
      if (!row) return;
      let author = authorCacheRef.current.get(row.user_id) || null;
      if (!author) {
        const { data } = await fetchAuthorProfile(row.user_id);
        if (data) { author = data; authorCacheRef.current.set(row.user_id, author); }
      }
      // Cue on others' messages, but not when they @mention you — that emits a
      // `mention` notification which plays its own cue (avoids a double).
      if (row.user_id !== userId && !(row.mentioned_user_ids || []).includes(userId)) playMessage();
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, author }]));
      // Still looking at this room's chat → keep the channel read cursor current.
      if (useChannel && userId && row.user_id !== userId) markConversationRead(convId, userId, "channel");
    });

    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, (payload) => {
      const row = norm(payload.new);
      if (!row) return;
      setMessages((prev) => {
        if (row.deleted_at) return prev.filter((m) => m.id !== row.id);
        return prev.map((m) => (m.id === row.id ? { ...m, ...row, author: m.author } : m));
      });
    });

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, convId, userId]);

  const send = useCallback(
    async (body, mentionedUserIds = []) => {
      if (!roomId || !userId) return { error: { message: "Not ready" } };
      const res = convId ? await sendChannelMessage(convId, userId, body) : await sendMessage(roomId, userId, body, mentionedUserIds);
      if (!res?.error) playMessage(); // cue your own send (the realtime echo is skipped)
      return res;
    },
    [roomId, userId, convId]
  );

  const edit = useCallback(
    (messageId, body) => (convId ? editChannelMessage(messageId, body) : editMessage(messageId, body)),
    [convId]
  );
  const remove = useCallback(
    (messageId) => (convId ? deleteChannelMessage(messageId) : deleteMessage(messageId)),
    [convId]
  );

  return { messages, loading, error, send, edit, remove };
}
