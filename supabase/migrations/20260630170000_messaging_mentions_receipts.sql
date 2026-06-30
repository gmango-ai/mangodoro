-- Messaging v2 — Phase 6: read receipts ("seen by").
--
-- @-mentions are client-only — they reuse the existing emit_mention RPC
-- (20260624210000), so there's no schema change for them. This migration adds a
-- single RPC the open thread calls to render "seen by" avatars: every
-- participant's read cursor for a conversation.
--   - dm/group: cursors live on conversation_participants.last_read_at
--   - channel:  cursors live on channel_read_state.last_read_at
-- SECURITY DEFINER + an access gate so only people who can see the conversation
-- can read its cursors.

create or replace function public.conversation_read_marks(p_conversation_id uuid)
returns table (user_id uuid, last_read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with guard as (
    select public.can_access_conversation(p_conversation_id) as ok
  )
  select cp.user_id, cp.last_read_at
    from public.conversation_participants cp, guard
   where guard.ok and cp.conversation_id = p_conversation_id and cp.last_read_at is not null
  union all
  select crs.user_id, crs.last_read_at
    from public.channel_read_state crs, guard
   where guard.ok and crs.conversation_id = p_conversation_id;
$$;
grant execute on function public.conversation_read_marks(uuid) to authenticated;

notify pgrst, 'reload schema';
