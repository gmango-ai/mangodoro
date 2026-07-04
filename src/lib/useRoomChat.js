import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import {
  fetchRecentMessages,
  fetchAuthorProfile,
  sendMessage,
  editMessage,
  deleteMessage,
} from "./chatMessages";
import { playMessage } from "./uiSounds";

// React hook: returns the room's chat history + live updates.
// Caller passes the signed-in user id so it can be embedded in send
// calls without re-reading session context inside the hook.
//
// Strategy:
//   - Fetch one page on mount (most-recent 50, oldest-first).
//   - Subscribe to INSERT + UPDATE on chat_messages filtered to this
//     room. On INSERT, hydrate the author lazily (cached in a ref so
//     we don't repeatedly hit user_settings for chatty users). On
//     UPDATE, swap the row in place — including soft-delete, which
//     drops it from the visible list.
//   - Expose send/edit/remove that do an optimistic local append
//     before the server roundtrip. The realtime echo will overwrite
//     the optimistic row by id, so the final UI is always the
//     authoritative server row.
export function useRoomChat(roomId, userId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const messageIdsRef = useRef(new Set());

  // Profile cache shared between initial fetch and realtime hydration.
  const authorCacheRef = useRef(new Map());
  const cacheAuthors = (rows) => {
    for (const r of rows) {
      if (r.author) authorCacheRef.current.set(r.user_id, r.author);
    }
  };

  useEffect(() => {
    if (!roomId) {
      messageIdsRef.current = new Set();
      setMessages([]);
      setLoading(false);
      return;
    }
    messageIdsRef.current = new Set();
    let alive = true;
    setLoading(true);
    setError(null);
    fetchRecentMessages(roomId).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) setError(err);
      cacheAuthors(data);
      messageIdsRef.current = new Set([...messageIdsRef.current, ...data.map((m) => m.id)]);
      setMessages((prev) => {
        const fetchedIds = new Set(data.map((m) => m.id));
        return [...data, ...prev.filter((m) => !fetchedIds.has(m.id))];
      });
      setLoading(false);
    });
    return () => { alive = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`chat:${roomId}`);

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `room_id=eq.${roomId}`,
      },
      async (payload) => {
        const row = payload.new;
        if (!row) return;
        if (messageIdsRef.current.has(row.id)) return;
        messageIdsRef.current.add(row.id);
        // Hydrate author via cache; fall back to a lookup for unseen users.
        let author = authorCacheRef.current.get(row.user_id) || null;
        if (!author) {
          const { data } = await fetchAuthorProfile(row.user_id);
          if (data) {
            author = data;
            authorCacheRef.current.set(row.user_id, author);
          }
        }
        // Cue on others' messages, but not when they @mention you — that emits a
        // `mention` notification which plays its own cue (avoids a double).
        if (row.user_id !== userId && !(row.mentioned_user_ids || []).includes(userId)) {
          playMessage();
        }
        setMessages((prev) => {
          // De-dupe against optimistic local rows AND duplicate echoes
          // (realtime occasionally re-delivers on reconnect).
          if (prev.some((m) => m.id === row.id)) return prev;
          return [...prev, { ...row, author }];
        });
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "chat_messages",
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        setMessages((prev) => {
          // Soft-delete → drop the bubble entirely.
          if (row.deleted_at) return prev.filter((m) => m.id !== row.id);
          return prev.map((m) =>
            m.id === row.id ? { ...m, ...row, author: m.author } : m
          );
        });
      }
    );

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, userId]);

  const send = useCallback(
    async (body, mentionedUserIds = []) => {
      if (!roomId || !userId) return { error: { message: "Not ready" } };
      const res = await sendMessage(roomId, userId, body, mentionedUserIds);
      if (!res?.error) playMessage(); // cue your own send (the realtime echo is skipped)
      return res;
    },
    [roomId, userId]
  );

  const edit = useCallback((messageId, body) => editMessage(messageId, body), []);
  const remove = useCallback((messageId) => deleteMessage(messageId), []);

  return { messages, loading, error, send, edit, remove };
}
