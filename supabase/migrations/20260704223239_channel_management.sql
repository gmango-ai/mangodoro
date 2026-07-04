-- Channel management suite: per-channel colour, archive, message retention
-- (auto-clear), allow-images, and force-notify (members can't mute).
--
-- Fresh timestamp — rewrites list_my_conversations from 20260704215200.

alter table public.conversations add column if not exists color          text;
alter table public.conversations add column if not exists archived_at    timestamptz;
alter table public.conversations add column if not exists retention_days int;   -- null/0 = keep forever
alter table public.conversations add column if not exists allow_images   boolean not null default true;
alter table public.conversations add column if not exists force_notify   boolean not null default false;

-- Extend set_channel_meta with the new fields (drop the 4-arg version first —
-- CREATE OR REPLACE can't change the signature). null args leave a field alone.
drop function if exists public.set_channel_meta(uuid, text, text, text);
create or replace function public.set_channel_meta(
  p_conversation_id uuid,
  p_title text default null,
  p_topic text default null,
  p_post_policy text default null,
  p_color text default null,
  p_archived boolean default null,
  p_retention_days int default null,
  p_allow_images boolean default null,
  p_force_notify boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid; v_org_team uuid;
begin
  select team_id, org_team_id into v_team, v_org_team
    from public.conversations where id = p_conversation_id and kind = 'channel';
  if v_team is null then raise exception 'not a channel'; end if;
  if not public.is_org_admin(v_team)
     and not (v_org_team is not null and exists (
       select 1 from public.org_team_members
        where org_team_id = v_org_team and user_id = auth.uid() and role = 'lead')) then
    raise exception 'must be an org admin or team lead';
  end if;
  if p_post_policy is not null and p_post_policy not in ('all', 'admins') then
    raise exception 'bad post_policy';
  end if;
  update public.conversations set
    title          = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    topic          = coalesce(p_topic, topic),
    post_policy    = coalesce(p_post_policy, post_policy),
    color          = case when p_color is null then color when btrim(p_color) = '' then null else p_color end,
    archived_at    = case when p_archived is null then archived_at when p_archived then coalesce(archived_at, now()) else null end,
    retention_days = case when p_retention_days is null then retention_days when p_retention_days <= 0 then null else p_retention_days end,
    allow_images   = coalesce(p_allow_images, allow_images),
    force_notify   = coalesce(p_force_notify, force_notify)
   where id = p_conversation_id;
end; $$;
grant execute on function public.set_channel_meta(uuid, text, text, text, text, boolean, int, boolean, boolean) to authenticated;

-- Soft-delete messages past each channel's retention window; scheduled daily.
create or replace function public.purge_channel_retention()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.dm_messages m
     set deleted_at = now()
    from public.conversations c
   where m.conversation_id = c.id
     and c.retention_days is not null and c.retention_days > 0
     and m.deleted_at is null
     and m.created_at < now() - make_interval(days => c.retention_days);
end; $$;
do $$ begin
  perform cron.schedule('purge-channel-retention', '17 3 * * *', 'select public.purge_channel_retention()');
exception when others then null; end $$;

-- Inbox: return the new fields, and hide ARCHIVED channels from everyone except
-- org admins (who keep seeing them so they can restore).
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid, kind text, title text, last_message_at timestamptz, last_read_at timestamptz,
  participant_ids uuid[], org_team_id uuid, org_team_color text, org_ids uuid[],
  pinned_at timestamptz, muted_at timestamptz, topic text, post_policy text,
  created_by uuid, room_id uuid, folder_id uuid, folder_position int,
  color text, archived_at timestamptz, retention_days int, allow_images boolean, force_notify boolean
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
       and (c.archived_at is null or public.is_org_admin(c.team_id))
  ),
  chan_open as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.teams tt on tt.id = c.team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
      left join public.org_teams ot on ot.id = c.org_team_id
     where c.kind = 'channel' and c.visibility = 'org' and c.room_id is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
       and (crs.conversation_id is not null or tt.channels_auto_join)
       and (c.archived_at is null or public.is_org_admin(c.team_id))
  ),
  chan_room as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, r.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.rooms r on r.id = c.room_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and c.room_id is not null and r.archived_at is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
       and (c.archived_at is null or public.is_org_admin(c.team_id))
  )
  select c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]), null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[]), a.pinned_at, a.muted_at, c.topic, c.post_policy,
    c.created_by, c.room_id, c.folder_id, c.folder_position,
    c.color, c.archived_at, c.retention_days, c.allow_images, c.force_notify
  from dm_acc a join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid left join scoped s on s.cid = a.cid
  where a.hidden_at is null or c.last_message_at > a.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position,
    c.color, c.archived_at, c.retention_days, c.allow_images, c.force_notify
  from chan_acc ca join public.conversations c on c.id = ca.cid
  where ca.hidden_at is null or c.last_message_at > ca.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position,
    c.color, c.archived_at, c.retention_days, c.allow_images, c.force_notify
  from chan_open co join public.conversations c on c.id = co.cid
  where co.hidden_at is null or c.last_message_at > co.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, cr.last_read_at,
    '{}'::uuid[], cr.org_team_id, cr.org_team_color, array[cr.org_id],
    cr.pinned_at, cr.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id, c.folder_position,
    c.color, c.archived_at, c.retention_days, c.allow_images, c.force_notify
  from chan_room cr join public.conversations c on c.id = cr.cid
  where cr.hidden_at is null or c.last_message_at > cr.hidden_at
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
