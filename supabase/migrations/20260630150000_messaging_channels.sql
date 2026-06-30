-- Messaging v2 — Phase 2: manual org_team channels.
--
-- A channel is a conversations row kind='channel' bound to ONE org_team. Its
-- membership is VIRTUAL — derived from org_team_members, never materialized into
-- conversation_participants — so adding/removing a team member instantly changes
-- who can see the channel. Channels reuse dm_messages and the existing no-filter
-- realtime subscription; RLS (below) is what delivers messages to the right
-- people.
--
-- RLS recursion note: can_access_conversation is SECURITY DEFINER owned by the
-- table owner, which BYPASSES RLS on the tables it reads — this is what keeps the
-- conversations SELECT policy from recursing into itself. Safe ONLY because no
-- table here uses FORCE ROW LEVEL SECURITY (verified across supabase/migrations).

alter table public.conversations
  add column if not exists org_team_id uuid references public.org_teams(id) on delete cascade;

-- Many channels per team, names unique (case-insensitive) within a team.
create unique index if not exists conversations_channel_name_uniq
  on public.conversations (org_team_id, lower(title)) where kind = 'channel';

-- ── access helper: participant OR member of the channel's org_team ──
create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_conversation_participant(p_conversation_id)
    or exists (
      select 1
        from public.conversations c
        join public.org_team_members otm on otm.org_team_id = c.org_team_id
       where c.id = p_conversation_id and c.kind = 'channel' and otm.user_id = auth.uid()
    );
$$;
grant execute on function public.can_access_conversation(uuid) to authenticated;

-- ── switch read/write policies onto the combined helper ──
drop policy if exists "participant reads conversation" on public.conversations;
create policy "participant reads conversation" on public.conversations
  for select using (public.can_access_conversation(id));

drop policy if exists "participant reads messages" on public.dm_messages;
create policy "participant reads messages" on public.dm_messages
  for select using (public.can_access_conversation(conversation_id));

drop policy if exists "participant sends messages" on public.dm_messages;
create policy "participant sends messages" on public.dm_messages
  for insert with check (sender_id = auth.uid() and public.can_access_conversation(conversation_id));
-- (conversation_participants policies and dm_messages UPDATE left unchanged.)

-- ── per-user channel read cursor (sparse; NOT in realtime publication) ──
create table if not exists public.channel_read_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  muted_at        timestamptz,                          -- per-user channel mute (Phase 8)
  primary key (conversation_id, user_id)
);
alter table public.channel_read_state enable row level security;
drop policy if exists "member manages own channel read state" on public.channel_read_state;
create policy "member manages own channel read state" on public.channel_read_state
  for all using (user_id = auth.uid() and public.can_access_conversation(conversation_id))
          with check (user_id = auth.uid() and public.can_access_conversation(conversation_id));

-- ── creation RPC: admin (org) or lead (org_team) ──
create or replace function public.create_org_team_channel(p_org_team_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v_org uuid; v_title text; cid uuid;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then raise exception 'channel name required'; end if;
  select org_id into v_org from public.org_teams where id = p_org_team_id;
  if v_org is null then raise exception 'unknown team'; end if;
  -- gate: org admin OR org_team lead
  if not public.is_org_admin(v_org)
     and not exists (
       select 1 from public.org_team_members
        where org_team_id = p_org_team_id and user_id = me and role = 'lead'
     ) then
    raise exception 'must be an org admin or team lead';
  end if;
  insert into public.conversations (team_id, is_group, kind, org_team_id, title, created_by)
    values (v_org, false, 'channel', p_org_team_id, v_title, me)
    returning id into cid;
  -- Seed a first message so the channel shows up live (via the dm_messages
  -- realtime subscription) for every org_team member without a reload.
  insert into public.dm_messages (conversation_id, sender_id, body)
    values (cid, me, '#' || v_title || ' channel created.');
  return cid;
end; $$;
grant execute on function public.create_org_team_channel(uuid, text) to authenticated;

-- ── channel notifications: one inapp ping per member, deduped ──
-- Channels fan out to every org_team member, synchronously in the send txn, so
-- dedupe + inapp-only ('channel' default below) are mandatory to avoid a storm.
create or replace function public.tg_dm_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rec record; sender_name text; conv record;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into conv from public.conversations where id = new.conversation_id;
  select coalesce(nullif(btrim(us.name), ''), 'Someone') into sender_name
    from public.user_settings us where us.user_id = new.sender_id;

  if conv.kind = 'channel' then
    for rec in
      select otm.user_id
        from public.org_team_members otm
       where otm.org_team_id = conv.org_team_id and otm.user_id <> new.sender_id
         and not exists (
           select 1 from public.channel_read_state crs
            where crs.conversation_id = conv.id and crs.user_id = otm.user_id
              and crs.muted_at is not null
         )
    loop
      perform public.emit_notification(
        rec.user_id, 'channel',
        sender_name || ' in #' || coalesce(conv.title, 'a channel'),
        left(new.body, 140),
        jsonb_build_object('conversation_id', new.conversation_id, 'route', '/messages'),
        new.sender_id, conv.team_id, 'conversation', new.conversation_id,
        'channel:' || conv.id, 5
      );
    end loop;
    return new;
  end if;

  -- dm / group: ping each other participant. (Per-conversation mute is wired in
  -- Phase 8, which create-or-replaces this trigger to skip muted recipients.)
  for rec in
    select cp.user_id from public.conversation_participants cp
     where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id
  loop
    perform public.emit_notification(
      rec.user_id, 'dm',
      case when conv.is_group then sender_name || ' in ' || coalesce(conv.title, 'a group')
           else sender_name end,
      left(new.body, 140),
      jsonb_build_object('conversation_id', new.conversation_id, 'route', '/messages'),
      new.sender_id
    );
  end loop;
  return new;
end; $$;
-- trigger already exists from 20260627140000; create or replace updated the body.

-- 'channel' notifications default to inapp-only (no desktop storm).
create or replace function public.notif_type_default_channels(p_type text)
returns text[] language sql immutable as $$
  select case p_type
    when 'room_joined'  then array['inapp']
    when 'lunch_return' then array['inapp']
    when 'channel'      then array['inapp']
    else array['inapp', 'desktop']
  end;
$$;

-- ── recreate list_my_conversations() WITH the channel branch ──
-- dm/group: org_ids = intersection over participants (as Phase 1).
-- channel:  accessed via org_team_members; org_ids = [org_team.org_id];
--           read cursor + mute come from channel_read_state.
create or replace function public.list_my_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  participant_ids uuid[],
  org_team_id uuid,
  org_team_color text,
  org_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  -- dm/group I participate in
  dm_acc as (
    select cp.conversation_id as cid, cp.last_read_at
      from public.conversation_participants cp, me
     where cp.user_id = me.uid
  ),
  parts as (
    select cp.conversation_id as cid, cp.user_id
      from public.conversation_participants cp
     where cp.conversation_id in (select cid from dm_acc)
  ),
  sizes as (select cid, count(*) as n from parts group by cid),
  org_hits as (
    select p.cid, tm.team_id, count(distinct p.user_id) as hits
      from parts p join public.team_members tm on tm.user_id = p.user_id
     group by p.cid, tm.team_id
  ),
  scoped as (
    select oh.cid, array_agg(oh.team_id) as org_ids
      from org_hits oh join sizes s on s.cid = oh.cid
     where oh.hits = s.n group by oh.cid
  ),
  others as (
    select p.cid, array_agg(p.user_id) as participant_ids
      from parts p, me where p.user_id <> me.uid group by p.cid
  ),
  -- channels I can see via org_team membership
  chan_acc as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.muted_at
      from public.conversations c
      join public.org_team_members otm on otm.org_team_id = c.org_team_id
      join public.org_teams ot on ot.id = c.org_team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and otm.user_id = (select uid from me)
  )
  select
    c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]),
    null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[])
  from dm_acc a
  join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid
  left join scoped s on s.cid = a.cid
  union all
  select
    c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[],
    ca.org_team_id, ca.org_team_color,
    array[ca.org_id]
  from chan_acc ca
  join public.conversations c on c.id = ca.cid
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
