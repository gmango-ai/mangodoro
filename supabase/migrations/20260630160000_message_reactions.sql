-- Messaging v2 — Phase 5: emoji reactions on messages.
--
-- Access is gated by the message's conversation via can_access_conversation
-- (Phase 2), so channel members can react too. Added to the realtime publication
-- so counts update live without a reload.

create table if not exists public.dm_message_reactions (
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists dm_message_reactions_msg_idx on public.dm_message_reactions (message_id);

alter table public.dm_message_reactions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.dm_message_reactions;
exception when duplicate_object then null; end $$;

alter table public.dm_message_reactions enable row level security;

-- Helper: the conversation a message belongs to (security definer → no recursion).
create or replace function public.message_conversation_id(p_message_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select conversation_id from public.dm_messages where id = p_message_id;
$$;
grant execute on function public.message_conversation_id(uuid) to authenticated;

drop policy if exists "member reads reactions" on public.dm_message_reactions;
create policy "member reads reactions" on public.dm_message_reactions
  for select using (public.can_access_conversation(public.message_conversation_id(message_id)));

drop policy if exists "member adds own reaction" on public.dm_message_reactions;
create policy "member adds own reaction" on public.dm_message_reactions
  for insert with check (
    user_id = auth.uid()
    and public.can_access_conversation(public.message_conversation_id(message_id))
  );

drop policy if exists "member removes own reaction" on public.dm_message_reactions;
create policy "member removes own reaction" on public.dm_message_reactions
  for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';
