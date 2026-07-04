-- Manual channel ordering within a (shared) folder. A per-channel folder_position
-- lets admins drag channels into a deliberate order; it's shared team-wide like
-- the folders themselves. Default 0 → existing channels keep recency order until
-- someone reorders.
--
-- Fresh timestamp — depends on the folder columns from 20260704171035 / 180000.

alter table public.conversations add column if not exists folder_position int not null default 0;

-- Place a channel: set its folder (or null) AND rewrite the positions of the
-- whole target group in one atomic, admin-gated call. p_ordered_ids is the target
-- group's channel ids in their new order (with the moved channel already inserted
-- at the drop point). Handles both "move to another folder at position I" and
-- "reorder within the same folder".
create or replace function public.place_channel(p_conversation_id uuid, p_folder_id uuid, p_ordered_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid; v_folder_team uuid;
begin
  select team_id into v_team from public.conversations where id = p_conversation_id and kind = 'channel';
  if v_team is null then raise exception 'channel not found'; end if;
  if not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.user_id = auth.uid() and tm.role = 'admin') then
    raise exception 'only a team admin can organise channels';
  end if;
  if p_folder_id is not null then
    select team_id into v_folder_team from public.channel_folders where id = p_folder_id;
    if v_folder_team is distinct from v_team then raise exception 'folder belongs to a different team'; end if;
  end if;
  update public.conversations set folder_id = p_folder_id where id = p_conversation_id;
  if p_ordered_ids is not null and array_length(p_ordered_ids, 1) is not null then
    update public.conversations c set folder_position = x.ord
      from (select id, (ord - 1) as ord from unnest(p_ordered_ids) with ordinality as t(id, ord)) x
     where c.id = x.id and c.team_id = v_team and c.kind = 'channel';
  end if;
end; $$;
grant execute on function public.place_channel(uuid, uuid, uuid[]) to authenticated;

-- Inbox: same as before plus folder_position per row.
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
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at, crs.hidden_at
      from public.conversations c
      join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
      left join public.org_teams ot on ot.id = c.org_team_id
     where c.kind = 'channel' and c.visibility = 'org' and c.room_id is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
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
