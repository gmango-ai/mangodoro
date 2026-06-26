-- Direct & group messaging (outside rooms). Team-scoped: you can message people
-- you share an org with. conversations + participants + messages, with a
-- notification ("ping") to other participants on each new message (reuses the
-- notification layer's emit_notification; type 'dm' falls through to its
-- inapp+desktop default, so no registry change needed).

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid references public.teams(id) on delete set null, -- org scope (metadata)
  is_group        boolean not null default false,
  title           text,                  -- group name; null for 1:1
  created_by      uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conv_participants_user_idx on public.conversation_participants (user_id);

create table if not exists public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 8000),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index if not exists dm_messages_conv_idx on public.dm_messages (conversation_id, created_at desc);

-- Realtime: clients subscribe to dm_messages INSERT; RLS scopes delivery to the
-- caller's own conversations, so no explicit filter is needed.
alter table public.dm_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.dm_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.conversation_participants; exception when duplicate_object then null; end $$;

-- ── membership helper (security definer → no RLS recursion) ──
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_participants
     where conversation_id = p_conversation_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- ── RLS ──
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.dm_messages enable row level security;

-- Conversations: a participant reads their conversations. No client INSERT/UPDATE
-- — creation goes through the RPCs below so participants can't be spoofed.
drop policy if exists "participant reads conversation" on public.conversations;
create policy "participant reads conversation" on public.conversations
  for select using (public.is_conversation_participant(id));

-- Participants: a member reads everyone in conversations they're in, and may
-- update only their OWN row (last_read_at). Inserts go through the RPCs.
drop policy if exists "participant reads participants" on public.conversation_participants;
create policy "participant reads participants" on public.conversation_participants
  for select using (public.is_conversation_participant(conversation_id));
drop policy if exists "participant updates own row" on public.conversation_participants;
create policy "participant updates own row" on public.conversation_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Messages: read in your conversations; send as yourself into your conversations;
-- edit/soft-delete your own.
drop policy if exists "participant reads messages" on public.dm_messages;
create policy "participant reads messages" on public.dm_messages
  for select using (public.is_conversation_participant(conversation_id));
drop policy if exists "participant sends messages" on public.dm_messages;
create policy "participant sends messages" on public.dm_messages
  for insert with check (sender_id = auth.uid() and public.is_conversation_participant(conversation_id));
drop policy if exists "sender updates own messages" on public.dm_messages;
create policy "sender updates own messages" on public.dm_messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- Do caller + p_user share a team?
create or replace function public.shares_team_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members a
      join public.team_members b on a.team_id = b.team_id
     where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ── creation RPCs (security definer; the only way to make a conversation) ──

-- 1:1 DM — finds the existing conversation between exactly {me, other} or makes
-- one. Advisory lock on the sorted pair serializes concurrent first-messages.
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid; tid uuid;
begin
  if me is null or p_other is null or p_other = me then raise exception 'bad request'; end if;
  if not public.shares_team_with(p_other) then raise exception 'not a teammate'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(me::text, p_other::text) || greatest(me::text, p_other::text), 0));
  select c.id into cid
    from public.conversations c
    join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = me
    join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = p_other
   where c.is_group = false
     and (select count(*) from public.conversation_participants pp where pp.conversation_id = c.id) = 2
   limit 1;
  if cid is not null then return cid; end if;
  select team_id into tid from public.team_members a
    join public.team_members b on a.team_id = b.team_id
   where a.user_id = me and b.user_id = p_other limit 1;
  insert into public.conversations (team_id, is_group, created_by) values (tid, false, me) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id) values (cid, me), (cid, p_other);
  return cid;
end; $$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- Group — caller + the given users (each must share a team with the caller).
create or replace function public.create_group_conversation(p_title text, p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid; tid uuid; u uuid;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then raise exception 'no participants'; end if;
  foreach u in array p_user_ids loop
    if u <> me and not public.shares_team_with(u) then raise exception 'not a teammate'; end if;
  end loop;
  select team_id into tid from public.team_members where user_id = me limit 1;
  insert into public.conversations (team_id, is_group, title, created_by)
    values (tid, true, nullif(btrim(coalesce(p_title, '')), ''), me) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id)
    select cid, x from (select unnest(p_user_ids) as x union select me) s
    on conflict do nothing;
  return cid;
end; $$;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

-- ── new-message: bump last_message_at + ping the other participants ──
create or replace function public.tg_dm_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rec record; sender_name text; conv record;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into conv from public.conversations where id = new.conversation_id;
  select coalesce(nullif(btrim(us.name), ''), 'Someone') into sender_name
    from public.user_settings us where us.user_id = new.sender_id;
  for rec in
    select user_id from public.conversation_participants
     where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.emit_notification(
      rec.user_id,
      'dm',
      case when conv.is_group then sender_name || ' in ' || coalesce(conv.title, 'a group')
           else sender_name end,
      left(new.body, 140),
      jsonb_build_object('conversation_id', new.conversation_id, 'route', '/messages'),
      new.sender_id
    );
  end loop;
  return new;
end; $$;
drop trigger if exists dm_message_notify on public.dm_messages;
create trigger dm_message_notify after insert on public.dm_messages
  for each row execute function public.tg_dm_message_notify();
