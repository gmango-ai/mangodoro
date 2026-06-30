import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useApp } from "./AppContext";
import { useTeamOptional } from "./TeamContext";
import { listConversations, getOrCreateDm, createGroupConversation, createOrgTeamChannel, markConversationRead } from "../lib/messages";

// Direct / group / channel messaging — in-app layer. One realtime channel
// watches every messaging table the open thread cares about — dm_messages
// (insert/edit/delete), dm_message_reactions, and dm_message_attachments (all
// RLS-scoped to my conversations + channels). Each change is fanned out to the
// open thread, which reconciles from the server so nothing goes stale, and
// dm_messages changes also refresh the conversation list (last message / unread).
//
// Org scope is computed in list_my_conversations() and returned as org_ids per
// row. `activeConversations` is the active org's inbox; `unread` is global (so
// the nav dot means "any org has unread"); `unreadByOrg` powers the per-org
// switcher counts.

const MessagesContext = createContext(null);
export const useMessages = () => useContext(MessagesContext) || {};

export function MessagesProvider({ children }) {
  const { session } = useApp();
  const userId = session?.user?.id;
  // useTeamOptional so the provider still mounts in contexts without a full
  // TeamProvider (e.g. the kiosk); falls back to an unscoped inbox there.
  const team = useTeamOptional() || {};
  const activeTeamId = team.activeTeamId || null;
  const teamMembers = team.teamMembers || [];
  const [conversations, setConversations] = useState([]);
  const convListeners = useRef(new Set());
  const reloadTimer = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) { setConversations([]); return; }
    setConversations(await listConversations(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) { setConversations([]); return undefined; }
    reload();
    const fanout = (table) => (payload) => {
      const evt = { table, eventType: payload.eventType, new: payload.new, old: payload.old };
      for (const fn of convListeners.current) { try { fn(evt); } catch { /* */ } }
      // New / edited / deleted messages also move the conversation list.
      if (table === "dm_messages") {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(reload, 250);
      }
    };
    const channel = supabase
      .channel(`dm:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_messages" }, fanout("dm_messages"))
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_message_reactions" }, fanout("dm_message_reactions"))
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_message_attachments" }, fanout("dm_message_attachments"))
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch { /* */ }
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [userId, reload]);

  const memberIds = useMemo(() => new Set(teamMembers.map((m) => m.user_id)), [teamMembers]);

  // Active-org inbox. Channels scope by org_ids (their org_team's org); dm/group
  // by the roster rule — "every other participant is in the active org" — which
  // is exactly `activeTeamId ∈ org_ids` and also works in the legacy fallback
  // where org_ids is empty.
  const activeConversations = useMemo(() => {
    return conversations.filter((c) =>
      c.kind === "channel"
        ? (c.org_ids || []).includes(activeTeamId)
        : c.participant_ids.every((id) => memberIds.has(id)),
    );
  }, [conversations, memberIds, activeTeamId]);

  // Global: any org with unread (drives the nav dot). Muted convos already drop
  // their unread flag in listConversations.
  const unread = useMemo(() => conversations.filter((c) => c.unread).length, [conversations]);

  // Per-org unread counts for the OrgSwitcher. Needs org_ids (RPC path); empty
  // in the legacy fallback until the migration applies.
  const unreadByOrg = useMemo(() => {
    const m = new Map();
    for (const c of conversations) {
      if (!c.unread) continue;
      for (const oid of c.org_ids || []) m.set(oid, (m.get(oid) || 0) + 1);
    }
    return m;
  }, [conversations]);

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

  const createChannel = useCallback(async (orgTeamId, title) => {
    const { id } = await createOrgTeamChannel(orgTeamId, title);
    if (id) await reload();
    return id;
  }, [reload]);

  const markRead = useCallback(async (convId, kind = "dm") => {
    if (!userId || !convId) return;
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: false } : c)));
    await markConversationRead(convId, userId, kind);
  }, [userId]);

  // The open thread registers here to receive every change (message edit/delete/
  // insert, reaction, attachment) for its conversation and reconcile from server.
  const subscribeConversation = useCallback((fn) => {
    convListeners.current.add(fn);
    return () => convListeners.current.delete(fn);
  }, []);

  const value = {
    conversations, activeConversations, unread, unreadByOrg, reload,
    startDm, createGroup, createChannel, markRead, subscribeConversation,
  };
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
