import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useApp } from "./AppContext";
import { listConversations, getOrCreateDm, createGroupConversation, markConversationRead } from "../lib/messages";

// Direct/group messaging — in-app layer. One realtime channel on dm_messages
// (RLS scopes delivery to my conversations) drives the conversation list +
// unread badge, and streams new messages to whatever thread is open. Mirrors
// NotificationContext's shape.

const MessagesContext = createContext(null);
export const useMessages = () => useContext(MessagesContext) || {};

export function MessagesProvider({ children }) {
  const { session } = useApp();
  const userId = session?.user?.id;
  const [conversations, setConversations] = useState([]);
  const msgListeners = useRef(new Set());
  const reloadTimer = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) { setConversations([]); return; }
    setConversations(await listConversations(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) { setConversations([]); return undefined; }
    reload();
    const channel = supabase
      .channel(`dm:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, (payload) => {
        for (const fn of msgListeners.current) { try { fn(payload.new); } catch { /* */ } }
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(reload, 250);
      })
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch { /* */ }
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [userId, reload]);

  const unread = useMemo(() => conversations.filter((c) => c.unread).length, [conversations]);

  const startDm = useCallback(async (otherId) => {
    const { id } = await getOrCreateDm(otherId);
    if (id) await reload();
    return id;
  }, [reload]);

  const createGroup = useCallback(async (title, ids) => {
    const { id } = await createGroupConversation(title, ids);
    if (id) await reload();
    return id;
  }, [reload]);

  const markRead = useCallback(async (convId) => {
    if (!userId || !convId) return;
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: false } : c)));
    await markConversationRead(convId, userId);
  }, [userId]);

  // The open thread registers here to receive new messages live.
  const subscribeMessages = useCallback((fn) => {
    msgListeners.current.add(fn);
    return () => msgListeners.current.delete(fn);
  }, []);

  const value = { conversations, unread, reload, startDm, createGroup, markRead, subscribeMessages };
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
