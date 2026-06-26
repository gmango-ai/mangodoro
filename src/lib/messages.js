import { supabase } from "../supabase";

// Direct & group messaging data layer. Conversations + participants + messages
// sit behind RLS (you only ever see your own conversations); creation goes
// through SECURITY DEFINER RPCs (get_or_create_dm / create_group_conversation).

export async function getOrCreateDm(otherUserId) {
  const { data, error } = await supabase.rpc("get_or_create_dm", { p_other: otherUserId });
  return { id: data || null, error };
}

export async function createGroupConversation(title, userIds) {
  const { data, error } = await supabase.rpc("create_group_conversation", { p_title: title || null, p_user_ids: userIds });
  return { id: data || null, error };
}

// My conversations + their participants (RLS scopes both), combined into a list
// with the other participants and an unread flag. `userId` = the current user.
export async function listConversations(userId) {
  const [{ data: convos }, { data: parts }] = await Promise.all([
    supabase.from("conversations").select("id, is_group, title, last_message_at, created_by").order("last_message_at", { ascending: false }),
    supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at"),
  ]);
  const myRead = new Map();   // conversation_id -> my last_read_at
  const others = new Map();   // conversation_id -> [other user_id]
  for (const p of parts || []) {
    if (p.user_id === userId) myRead.set(p.conversation_id, p.last_read_at);
    else { const a = others.get(p.conversation_id) || []; a.push(p.user_id); others.set(p.conversation_id, a); }
  }
  return (convos || []).map((c) => {
    const lastRead = myRead.get(c.id);
    return {
      id: c.id,
      is_group: c.is_group,
      title: c.title,
      created_by: c.created_by,
      last_message_at: c.last_message_at,
      participant_ids: others.get(c.id) || [],
      unread: !!c.last_message_at && (!lastRead || new Date(c.last_message_at) > new Date(lastRead)),
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

export async function sendMessage(conversationId, body, userId) {
  const { data, error } = await supabase
    .from("dm_messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body })
    .select()
    .single();
  if (!error) markConversationRead(conversationId, userId); // my own send shouldn't read as unread
  return { message: data || null, error };
}

export async function markConversationRead(conversationId, userId) {
  if (!conversationId || !userId) return;
  await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}
