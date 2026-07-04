import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useApp } from "./AppContext";
import { useTeamOptional } from "./TeamContext";
import { listConversations, getOrCreateDm, createGroupConversation, createOrgTeamChannel, markConversationRead, listJoinableChannels, joinChannel, deleteConversation as apiDeleteConversation, hideConversation as apiHideConversation, listChannelFolders, createChannelFolder, renameChannelFolder, deleteChannelFolder, reorderChannelFolders, setChannelFolder, placeChannel, setChannelMeta } from "../lib/messages";

// Direct / group / channel messaging — in-app layer. One realtime channel on
// dm_messages (RLS scopes delivery to my conversations + my channels) drives
// the list + unread badges and streams new messages to whatever thread is open.
// A second listener on dm_message_reactions keeps reaction counts live.
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
  const isTeamAdmin = !!team.isAdmin;
  const [conversations, setConversations] = useState([]);
  const [folders, setFolders] = useState([]); // shared, team-wide channel folders (active org)
  const msgListeners = useRef(new Set());
  const reactionListeners = useRef(new Set());
  const reloadTimer = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) { setConversations([]); return; }
    setConversations(await listConversations(userId));
  }, [userId]);

  const reloadFolders = useCallback(async () => {
    if (!activeTeamId) { setFolders([]); return; }
    setFolders(await listChannelFolders(activeTeamId));
  }, [activeTeamId]);

  useEffect(() => { reloadFolders(); }, [reloadFolders]);

  const createFolder = useCallback(async (name) => {
    if (!activeTeamId) return null;
    const { id } = await createChannelFolder(activeTeamId, name);
    if (id) await reloadFolders();
    return id;
  }, [activeTeamId, reloadFolders]);
  const renameFolder = useCallback(async (id, name) => { await renameChannelFolder(id, name); await reloadFolders(); }, [reloadFolders]);
  const deleteFolder = useCallback(async (id) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    await deleteChannelFolder(id);
    await Promise.all([reloadFolders(), reload()]);
  }, [reloadFolders, reload]);
  const reorderFolders = useCallback(async (ids) => {
    setFolders((prev) => ids.map((id) => prev.find((f) => f.id === id)).filter(Boolean));
    await reorderChannelFolders(ids);
    await reloadFolders();
  }, [reloadFolders]);
  const assignFolder = useCallback(async (conversationId, folderId) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, folder_id: folderId || null } : c)));
    await setChannelFolder(conversationId, folderId);
    await reload();
  }, [reload]);

  // Drop a channel into a folder (or null) at a specific spot: update the moved
  // channel's folder + rewrite folder_position for the whole target group so the
  // manual order sticks. orderedIds = the target group's ids in their new order.
  const placeChannelAt = useCallback(async (conversationId, folderId, orderedIds) => {
    const pos = new Map((orderedIds || []).map((id, i) => [id, i]));
    setConversations((prev) => prev.map((c) => {
      if (c.id === conversationId) return { ...c, folder_id: folderId || null, folder_position: pos.get(c.id) ?? c.folder_position };
      return pos.has(c.id) ? { ...c, folder_position: pos.get(c.id) } : c;
    }));
    await placeChannel(conversationId, folderId, orderedIds);
    await reload();
  }, [reload]);

  useEffect(() => {
    if (!userId) { setConversations([]); return undefined; }
    reload();
    const channel = supabase
      // Per-mount unique suffix: StrictMode remounts subscribe again while the
      // old channel (same topic) is still tearing down. Cleanup below removes
      // the channel, so names never accumulate.
      .channel(`dm:${userId}:${randomId(6)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, (payload) => {
        for (const fn of msgListeners.current) { try { fn(payload.new); } catch { /* */ } }
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(reload, 250);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_message_reactions" }, (payload) => {
        for (const fn of reactionListeners.current) { try { fn(payload); } catch { /* */ } }
      })
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

  const createChannel = useCallback(async (orgTeamId, title, visibility = "org_team", announcement = false) => {
    const { id } = await createOrgTeamChannel(orgTeamId, title, visibility);
    if (id) {
      if (announcement) await setChannelMeta(id, { postPolicy: "admins" });
      await reload();
    }
    return id;
  }, [reload]);

  // Browse open channels the user can join, and join one (then it lands in the
  // inbox). Powers the "Browse channels" surface in the New-message sheet.
  const browseChannels = useCallback(async () => {
    const { data } = await listJoinableChannels();
    return data;
  }, []);
  const joinOpenChannel = useCallback(async (conversationId) => {
    const { error } = await joinChannel(conversationId);
    if (!error) await reload();
    return !error;
  }, [reload]);

  // Delete a channel/group for everyone (drop it from local state immediately,
  // then reconcile). Leave/hide just removes it from MY inbox.
  const deleteConversation = useCallback(async (convId) => {
    const { error } = await apiDeleteConversation(convId);
    if (!error) setConversations((prev) => prev.filter((c) => c.id !== convId));
    await reload();
    return !error;
  }, [reload]);

  const hideConversation = useCallback(async (convId) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    const { error } = await apiHideConversation(convId);
    if (error) await reload();
    return !error;
  }, [reload]);

  const markRead = useCallback(async (convId, kind = "dm") => {
    if (!userId || !convId) return;
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: false } : c)));
    await markConversationRead(convId, userId, kind);
  }, [userId]);

  // The open thread registers here to receive new messages / reaction changes live.
  const subscribeMessages = useCallback((fn) => {
    msgListeners.current.add(fn);
    return () => msgListeners.current.delete(fn);
  }, []);
  const subscribeReactions = useCallback((fn) => {
    reactionListeners.current.add(fn);
    return () => reactionListeners.current.delete(fn);
  }, []);

  const value = useMemo(() => ({
    conversations, activeConversations, unread, unreadByOrg, reload,
    startDm, createGroup, createChannel, browseChannels, joinOpenChannel,
    deleteConversation, hideConversation,
    folders, isTeamAdmin, createFolder, renameFolder, deleteFolder, reorderFolders, assignFolder, placeChannelAt,
    markRead, subscribeMessages, subscribeReactions,
  };
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
