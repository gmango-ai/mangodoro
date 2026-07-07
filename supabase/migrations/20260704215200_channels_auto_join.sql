-- Org setting: automatically add everyone to open channels. When a team turns on
-- channels_auto_join, every OPEN ('org' visibility, non-room) channel auto-lists
-- for all team members without them needing to Browse + Join — exactly like room
-- channels do. Off (default) keeps the browse-to-join behaviour.
--
-- Fresh timestamp — rewrites list_my_conversations from 20260704172449 with the
-- chan_open branch widened to include auto-listed open channels.

alter table public.teams add column if not exists channels_auto_join boolean not null default false;

drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid, kind text, title text, last_message_at timestamptz, last_read_at timestamptz,
  participant_ids uuid[], org_team_id uuid, org_team_color text, org_ids uuid[],
  pinned_at timestamptz, muted_at timestamptz, topic text, post_policy text,
  created_by uuid, room_id uuid, folder_id uuid, folder_position int
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  dm_acc as (
    select cp.conversation_id as cid, cp.last_read_at, cp.pinned_at, cp.muted_at, cp.hidden_at
      from public.conversation_participants cp, me where cp.user_id = me.uid
  ),
  parts as (
    select cp.conversation_id as cid, cp.user_id from public.conversation_participants cp
     where cp.conversation_id in (select cid from dm_acc)
  ),
  sizes as (select cid, count(*) as n from parts group by cid),
  org_hits as (
    select p.cid, tm.team_id, count(distinct p.user_id) as hits
      from parts p join public.team_members tm on tm.user_id = p.user_id group by p.cid, tm.team_id
  ),
  scoped as (
    select oh.cid, array_agg(oh.team_id) as org_ids from org_hits oh join sizes s on s.cid = oh.cid
     where oh.hits = s.n group by oh.cid
  ),
  others as (
    select p.cid, array_agg(p.user_id) as participant_ids from parts p, me where p.user_id <> me.uid group by p.cid
  ),
  chan_acc as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.org_team_members otm on otm.org_team_id = c.org_team_id
      join public.org_teams ot on ot.id = c.org_team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and c.visibility = 'org_team' and otm.user_id = (select uid from me)
  ),
  chan_open as (
    -- Joined open channels always; ALL open channels when the team auto-joins.
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.teams tt on tt.id = c.team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
      left join public.org_teams ot on ot.id = c.org_team_id
     where c.kind = 'channel' and c.visibility = 'org' and c.room_id is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
       and (crs.conversation_id is not null or tt.channels_auto_join)
  ),
  chan_room as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, r.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.rooms r on r.id = c.room_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and c.room_id is not null and r.archived_at is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
  )
  select c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]), null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[]), a.pinned_at, a.muted_at, c.topic, c.post_policy,
    c.created_by, c.room_id, c.folder_id, c.folder_position
  from dm_acc a join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid left join scoped s on s.cid = a.cid
  where a.hidden_at is null or c.last_message_at > a.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position
  from chan_acc ca join public.conversations c on c.id = ca.cid
  where ca.hidden_at is null or c.last_message_at > ca.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position
  from chan_open co join public.conversations c on c.id = co.cid
  where co.hidden_at is null or c.last_message_at > co.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, cr.last_read_at,
    '{}'::uuid[], cr.org_team_id, cr.org_team_color, array[cr.org_id],
    cr.pinned_at, cr.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position
  from chan_room cr join public.conversations c on c.id = cr.cid
  where cr.hidden_at is null or c.last_message_at > cr.hidden_at
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
