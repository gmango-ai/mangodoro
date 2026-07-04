-- Open-join channels with an OPTIONAL team lock (Stage 1 of rooms↔channels).
--
-- Channels were always locked to one org_team (department): only its members
-- could see or post. This adds `conversations.visibility`:
--   'org_team' — locked to the channel's org_team (previous behaviour, default).
--   'org'      — open: any member of the org (team_id) can browse, join, post.
-- Existing channels default to 'org_team', so nothing changes for them.
-- "Joining" an open channel materialises a channel_read_state row — that's what
-- puts it in your inbox and tracks unread (org_team channels stay virtual).
--
-- Fresh timestamp (latest applied on the shared DB is 20260704130000).

alter table public.conversations
  add column if not exists visibility text not null default 'org_team';
do $$ begin
  alter table public.conversations
    add constraint conversations_visibility_chk check (visibility in ('org_team','org'));
exception when duplicate_object then null; end $$;

-- Access: a participant, OR an org_team member of an 'org_team' channel, OR
-- (NEW) any org member of an 'org'-visibility channel.
create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_conversation_participant(p_conversation_id)
    or exists (
      select 1 from public.conversations c
      join public.org_team_members otm on otm.org_team_id = c.org_team_id
     where c.id = p_conversation_id and c.kind = 'channel'
       and c.visibility = 'org_team' and otm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.conversations c
      join public.team_members tm on tm.team_id = c.team_id
     where c.id = p_conversation_id and c.kind = 'channel'
       and c.visibility = 'org' and tm.user_id = auth.uid()
    );
$$;

-- Posting: DMs/groups need participation; channels respect post_policy, and an
-- 'org' channel lets any org member post (unless it's an admins-only channel).
create or replace function public.can_post_in_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with c as (select * from public.conversations where id = p_conversation_id)
  select case
    when (select kind from c) <> 'channel' then public.is_conversation_participant(p_conversation_id)
    when (select post_policy from c) = 'admins' then
      public.is_org_admin((select team_id from c))
      or exists (select 1 from public.org_team_members otm
                  where otm.org_team_id = (select org_team_id from c)
                    and otm.user_id = auth.uid() and otm.role = 'lead')
    when (select visibility from c) = 'org' then
      exists (select 1 from public.team_members tm
               where tm.team_id = (select team_id from c) and tm.user_id = auth.uid())
    else exists (select 1 from public.org_team_members otm
                  where otm.org_team_id = (select org_team_id from c) and otm.user_id = auth.uid())
  end;
$$;

-- Create a channel, optionally OPEN to the whole org. Open channels aren't tied
-- to a department, so p_org_team_id may be null for them. Drop the old 2-arg
-- overload so the new one (with a defaulted p_visibility) is unambiguous — a
-- 2-arg call still works and defaults to the locked 'org_team' behaviour.
drop function if exists public.create_org_team_channel(uuid, text);
create or replace function public.create_org_team_channel(
  p_org_team_id uuid, p_title text, p_visibility text default 'org_team'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_org uuid;
  v_title text;
  v_vis text := case when p_visibility = 'org' then 'org' else 'org_team' end;
  cid uuid;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then raise exception 'channel name required'; end if;

  if v_vis = 'org' then
    -- Open channel: scope to one of the caller's orgs (from the passed team, or
    -- their first org membership). Any org member may start one.
    if p_org_team_id is not null then
      select org_id into v_org from public.org_teams where id = p_org_team_id;
    end if;
    if v_org is null then
      select team_id into v_org from public.team_members where user_id = me limit 1;
    end if;
    if v_org is null then raise exception 'no org'; end if;
    insert into public.conversations (team_id, is_group, kind, org_team_id, title, created_by, visibility)
      values (v_org, false, 'channel', null, v_title, me, 'org')
      returning id into cid;
    -- Creator joins their own open channel so it lands in their inbox.
    insert into public.channel_read_state (conversation_id, user_id, last_read_at)
      values (cid, me, now()) on conflict do nothing;
  else
    -- Team-locked channel: keep the previous admin/lead gate.
    select org_id into v_org from public.org_teams where id = p_org_team_id;
    if v_org is null then raise exception 'unknown team'; end if;
    if not public.is_org_admin(v_org)
       and not exists (
         select 1 from public.org_team_members
          where org_team_id = p_org_team_id and user_id = me and role = 'lead'
       ) then
      raise exception 'must be an org admin or team lead';
    end if;
    insert into public.conversations (team_id, is_group, kind, org_team_id, title, created_by, visibility)
      values (v_org, false, 'channel', p_org_team_id, v_title, me, 'org_team')
      returning id into cid;
  end if;

  insert into public.dm_messages (conversation_id, sender_id, body)
    values (cid, me, '#' || v_title || ' channel created.');
  return cid;
end; $$;
grant execute on function public.create_org_team_channel(uuid, text, text) to authenticated;

-- Join / leave an OPEN channel (materialises / clears the read-state row).
create or replace function public.join_channel(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'cannot access this channel';
  end if;
  insert into public.channel_read_state (conversation_id, user_id, last_read_at)
    values (p_conversation_id, auth.uid(), now())
    on conflict (conversation_id, user_id) do nothing;
end; $$;
grant execute on function public.join_channel(uuid) to authenticated;

create or replace function public.leave_channel(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.channel_read_state
   where conversation_id = p_conversation_id and user_id = auth.uid();
end; $$;
grant execute on function public.leave_channel(uuid) to authenticated;

-- Browse: open channels in the caller's org(s) they haven't joined yet.
create or replace function public.list_joinable_channels()
returns table (id uuid, title text, topic text, team_id uuid, member_count bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.topic, c.team_id,
    (select count(*) from public.channel_read_state crs where crs.conversation_id = c.id)
  from public.conversations c
  where c.kind = 'channel' and c.visibility = 'org'
    and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = auth.uid())
    and not exists (select 1 from public.channel_read_state crs
                     where crs.conversation_id = c.id and crs.user_id = auth.uid())
  order by c.last_message_at desc nulls last;
$$;
grant execute on function public.list_joinable_channels() to authenticated;

-- Inbox: add joined OPEN channels; keep org_team channels virtual (but only the
-- locked ones now, so an 'org' channel doesn't double-list).
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid, kind text, title text, last_message_at timestamptz, last_read_at timestamptz,
  participant_ids uuid[], org_team_id uuid, org_team_color text, org_ids uuid[],
  pinned_at timestamptz, muted_at timestamptz, topic text, post_policy text
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  dm_acc as (
    select cp.conversation_id as cid, cp.last_read_at, cp.pinned_at, cp.muted_at
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
  chan_acc as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at
      from public.conversations c
      join public.org_team_members otm on otm.org_team_id = c.org_team_id
      join public.org_teams ot on ot.id = c.org_team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and c.visibility = 'org_team' and otm.user_id = (select uid from me)
  ),
  chan_open as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at
      from public.conversations c
      join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
      left join public.org_teams ot on ot.id = c.org_team_id
     where c.kind = 'channel' and c.visibility = 'org'
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
  )
  select
    c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]),
    null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[]),
    a.pinned_at, a.muted_at, c.topic, c.post_policy
  from dm_acc a
  join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid
  left join scoped s on s.cid = a.cid
  union all
  select
    c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy
  from chan_acc ca
  join public.conversations c on c.id = ca.cid
  union all
  select
    c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy
  from chan_open co
  join public.conversations c on c.id = co.cid
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
