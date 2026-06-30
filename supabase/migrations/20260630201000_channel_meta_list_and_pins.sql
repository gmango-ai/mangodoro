-- Messaging v2 - channel metadata in inbox rows and channel pins.
--
-- Phase 9 added channel topic/post_policy, and Phase 8 exposed pin/mute state.
-- Keep the RPC shape in sync so reloads preserve channel policy UI and channel
-- pins persist through virtual membership.

alter table public.channel_read_state
  add column if not exists pinned_at timestamptz;

drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  participant_ids uuid[],
  org_team_id uuid,
  org_team_color text,
  org_ids uuid[],
  pinned_at timestamptz,
  muted_at timestamptz,
  topic text,
  post_policy text
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
     where c.kind = 'channel' and otm.user_id = (select uid from me)
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
    '{}'::uuid[],
    ca.org_team_id, ca.org_team_color,
    array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy
  from chan_acc ca
  join public.conversations c on c.id = ca.cid
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
