import { supabase } from "../supabase";

// Direct / group / channel messaging data layer. DMs & groups sit behind RLS
// (you only see conversations you participate in); channels are bound to an
// org_team and visibility is virtual (org_team_members). Creation goes through
// SECURITY DEFINER RPCs. The list comes from list_my_conversations(), which
// computes each conversation's org scope server-side.

export async function getOrCreateDm(otherUserId) {
  const { data, error } = await supabase.rpc("get_or_create_dm", { p_other: otherUserId });
  return { id: data || null, error };
}

export async function createGroupConversation(title, userIds) {
  const { data, error } = await supabase.rpc("create_group_conversation", { p_title: title || null, p_user_ids: userIds });
  return { id: data || null, error };
}

// Create a channel. visibility 'org_team' (default) locks it to the org_team
// (admin/lead only, as before); 'org' makes it OPEN — any org member can browse
// + join, and orgTeamId may be null.
export async function createOrgTeamChannel(orgTeamId, title, visibility = "org_team") {
  const { data, error } = await supabase.rpc("create_org_team_channel", {
    p_org_team_id: orgTeamId || null,
    p_title: title || null,
    p_visibility: visibility === "org" ? "org" : "org_team",
  });
  return { id: data || null, error };
}

// Open channels the caller can join (in their org, not yet joined).
export async function listJoinableChannels() {
  const { data, error } = await supabase.rpc("list_joinable_channels");
  return { data: data || [], error };
}

// Join / leave an OPEN channel (materialises / clears your inbox membership).
export async function joinChannel(conversationId) {
  const { error } = await supabase.rpc("join_channel", { p_conversation_id: conversationId });
  return { error };
}

export async function leaveChannel(conversationId) {
  const { error } = await supabase.rpc("leave_channel", { p_conversation_id: conversationId });
  return { error };
}

// Delete a channel/group for EVERYONE (creator / team admin / org_team lead;
// room channels are rejected server-side).
export async function deleteConversation(conversationId) {
  const { error } = await supabase.rpc("delete_conversation", { p_conversation_id: conversationId });
  return { error };
}

// Hide a conversation from just MY inbox (leave / remove-for-me). It reappears
// on its own when a newer message arrives.
export async function hideConversation(conversationId) {
  const { error } = await supabase.rpc("hide_conversation", { p_conversation_id: conversationId });
  return { error };
}

// ── Channel folders (shared, team-wide; admin-managed) ──
export async function listChannelFolders(teamId) {
  if (!teamId) return [];
  const { data } = await supabase
    .from("channel_folders")
    .select("id, team_id, name, position")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  return data || [];
}
export async function createChannelFolder(teamId, name) {
  const { data, error } = await supabase.rpc("create_channel_folder", { p_team_id: teamId, p_name: name || "Folder" });
  return { id: data || null, error };
}
export async function renameChannelFolder(folderId, name) {
  const { error } = await supabase.rpc("rename_channel_folder", { p_folder_id: folderId, p_name: name });
  return { error };
}
export async function deleteChannelFolder(folderId) {
  const { error } = await supabase.rpc("delete_channel_folder", { p_folder_id: folderId });
  return { error };
}
export async function reorderChannelFolders(folderIds) {
  const { error } = await supabase.rpc("reorder_channel_folders", { p_folder_ids: folderIds });
  return { error };
}
export async function setChannelFolder(conversationId, folderId) {
  const { error } = await supabase.rpc("set_channel_folder", { p_conversation_id: conversationId, p_folder_id: folderId || null });
  return { error };
}

const isUnread = (lastMessageAt, lastReadAt) =>
  !!lastMessageAt && (!lastReadAt || new Date(lastMessageAt) > new Date(lastReadAt));

// Whether a row should light the unread badge. Channels you were AUTO-listed
// into (room + org_team) have no read cursor until you actually open them, so
// their backfilled/pre-existing history would otherwise read as "unread" the
// moment they appear. Treat a channel with no read cursor as read — you only get
// a badge once you've opened it and genuinely-new messages arrive after. DMs and
// groups keep the plain rule (you were explicitly added to those).
const rowUnread = (kind, lastMessageAt, lastReadAt, mutedAt) => {
  if (mutedAt) return false;
  if (kind === "channel" && !lastReadAt) return false;
  return isUnread(lastMessageAt, lastReadAt);
};

// My conversations + computed org scope, in one round-trip. Falls back to the
// legacy table reads if the RPC isn't on the (shared) DB yet, so the client is
// safe to deploy before the migration applies — the page's roster filter keeps
// the active-org inbox correct in the meantime.
export async function listConversations(userId) {
  const { data, error } = await supabase.rpc("list_my_conversations");
  if (!error && Array.isArray(data)) {
    return data.map((c) => ({
      id: c.id,
      kind: c.kind || (c.is_group ? "group" : "dm"),
      is_group: c.kind === "group",            // legacy field, kept until Phase 3 reads use kind
      title: c.title,
      last_message_at: c.last_message_at,
      last_read_at: c.last_read_at,
      participant_ids: c.participant_ids || [],
      org_team_id: c.org_team_id || null,
      org_team_color: c.org_team_color || null,
      org_ids: c.org_ids || [],
      pinned_at: c.pinned_at || null,
      muted_at: c.muted_at || null,
      topic: c.topic || null,
      post_policy: c.post_policy || "all",
      created_by: c.created_by || null,
      room_id: c.room_id || null,
      folder_id: c.folder_id || null,
      unread: rowUnread(c.kind || (c.is_group ? "group" : "dm"), c.last_message_at, c.last_read_at, c.muted_at),
    }));
  }
  return listConversationsLegacy(userId);
}

// Pre-Phase-1 behavior: raw table reads (RLS scopes both). org_ids is empty
// here; the page filters by the active-org roster instead.
async function listConversationsLegacy(userId) {
  const [convosRes, partsRes, channelReadsRes] = await Promise.all([
    supabase.from("conversations").select("id, is_group, kind, title, last_message_at, created_by").order("last_message_at", { ascending: false }),
    supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at, pinned_at, muted_at"),
    supabase.from("channel_read_state").select("conversation_id, last_read_at, muted_at").eq("user_id", userId),
  ]);
  let parts = partsRes.data;
  if (partsRes.error) {
    const { data } = await supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at");
    parts = data;
  }
  const myRead = new Map();
  const myPrefs = new Map();
  const channelReads = new Map();
  for (const r of channelReadsRes.data || []) channelReads.set(r.conversation_id, r);
  const others = new Map();
  for (const p of parts || []) {
    if (p.user_id === userId) {
      myRead.set(p.conversation_id, p.last_read_at);
      myPrefs.set(p.conversation_id, { pinned_at: p.pinned_at || null, muted_at: p.muted_at || null });
    }
    else { const a = others.get(p.conversation_id) || []; a.push(p.user_id); others.set(p.conversation_id, a); }
  }
  return (convosRes.data || []).map((c) => {
    const channelRead = c.kind === "channel" ? channelReads.get(c.id) : null;
    const lastRead = channelRead?.last_read_at || myRead.get(c.id);
    const prefs = myPrefs.get(c.id) || {};
    const mutedAt = channelRead?.muted_at || prefs.muted_at || null;
    return {
      id: c.id,
      kind: c.kind || (c.is_group ? "group" : "dm"),
      is_group: c.is_group,
      title: c.title,
      created_by: c.created_by,
      last_message_at: c.last_message_at,
      last_read_at: lastRead,
      participant_ids: others.get(c.id) || [],
      org_team_id: null,
      org_team_color: null,
      org_ids: [],
      pinned_at: prefs.pinned_at || null,
      muted_at: mutedAt,
      topic: null,
      post_policy: "all",
      created_by: c.created_by || null,
      room_id: null,
      folder_id: null,
      unread: rowUnread(c.kind || (c.is_group ? "group" : "dm"), c.last_message_at, lastRead, mutedAt),
    };
  });
}

export async function listMessages(conversationId, limit = 80) {
  const { data } = await supabase
    .from("dm_messages")
    .select("id, conversation_id, sender_id, body, created_at, edited_at, deleted_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  return data || [];
}

export async function sendMessage(conversationId, body, userId, kind = "dm") {
  const { data, error } = await supabase
    .from("dm_messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body })
    .select()
    .single();
  if (!error) markConversationRead(conversationId, userId, kind); // my own send shouldn't read as unread
  return { message: data || null, error };
}

// Edit / soft-delete (RLS: sender only).
export async function editMessage(messageId, body) {
  const { data, error } = await supabase
    .from("dm_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select()
    .single();
  return { message: data || null, error };
}

export async function deleteMessage(messageId) {
  const { error } = await supabase
    .from("dm_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  return { error };
}

// Read cursor: channels keep theirs in channel_read_state (virtual membership
// means no conversation_participants row to update); dm/group use the
// participant row.
export async function markConversationRead(conversationId, userId, kind = "dm") {
  if (!conversationId || !userId) return;
  const now = new Date().toISOString();
  if (kind === "channel") {
    await supabase
      .from("channel_read_state")
      .upsert({ conversation_id: conversationId, user_id: userId, last_read_at: now }, { onConflict: "conversation_id,user_id" });
    return;
  }
  await supabase
    .from("conversation_participants")
    .update({ last_read_at: now })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

// ── Reactions (Phase 5) ──
export async function listReactions(messageIds, userId) {
  if (!messageIds || messageIds.length === 0) return new Map();
  const { data } = await supabase
    .from("dm_message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);
  // message_id -> emoji -> { count, mine }
  const byMessage = new Map();
  for (const r of data || []) {
    const m = byMessage.get(r.message_id) || new Map();
    const cur = m.get(r.emoji) || { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === userId) cur.mine = true;
    m.set(r.emoji, cur);
    byMessage.set(r.message_id, m);
  }
  return byMessage;
}

export async function toggleReaction(messageId, emoji, userId, mine) {
  if (!messageId || !emoji || !userId) return { error: null };
  if (mine) {
    const { error } = await supabase
      .from("dm_message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
    return { error };
  }
  const { error } = await supabase
    .from("dm_message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji });
  return { error };
}

// ── Read marks / seen-by (Phase 6) ──
export async function listReadMarks(conversationId) {
  const { data, error } = await supabase.rpc("conversation_read_marks", { p_conversation_id: conversationId });
  if (error) return [];
  return data || []; // [{ user_id, last_read_at }]
}

// ── Pin / mute (Phase 8) ──
export async function setConversationPinned(conversationId, userId, pinned, kind = "dm") {
  const at = pinned ? new Date().toISOString() : null;
  if (kind === "channel") {
    await supabase
      .from("channel_read_state")
      .upsert({ conversation_id: conversationId, user_id: userId, pinned_at: at }, { onConflict: "conversation_id,user_id" });
    return;
  }
  await supabase
    .from("conversation_participants")
    .update({ pinned_at: at })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

export async function setConversationMuted(conversationId, userId, muted, kind = "dm") {
  const at = muted ? new Date().toISOString() : null;
  if (kind === "channel") {
    await supabase
      .from("channel_read_state")
      .upsert({ conversation_id: conversationId, user_id: userId, muted_at: at }, { onConflict: "conversation_id,user_id" });
    return;
  }
  await supabase
    .from("conversation_participants")
    .update({ muted_at: at })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

// ── Channel admin (Phase 9) ──
export async function setChannelMeta(conversationId, { title, topic, postPolicy }) {
  const { error } = await supabase.rpc("set_channel_meta", {
    p_conversation_id: conversationId,
    p_title: title ?? null,
    p_topic: topic ?? null,
    p_post_policy: postPolicy ?? null,
  });
  return { error };
}
