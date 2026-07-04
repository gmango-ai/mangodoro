-- Deleting / leaving conversations + channels ("smart" behaviour):
--   • Owner (creator) / team admin / org_team lead can DELETE a channel or group
--     for everyone (cascades messages, participants, read-state). Room channels
--     belong to their room and can't be deleted here.
--   • Anyone else — and DMs — HIDE the conversation from their own inbox. Hidden
--     is a per-user TIMESTAMP threshold, not a hard flag: the row comes back on
--     its own the moment a newer message arrives (so "delete" never loses a live
--     conversation), and reopening/sending brings it straight back.
--
-- Fresh timestamp — latest applied on the shared DB is 20260704140527.

-- 1. Per-user hide threshold on both membership surfaces.
alter table public.conversation_participants add column if not exists hidden_at timestamptz;
alter table public.channel_read_state       add column if not exists hidden_at timestamptz;

-- 2. Hide a conversation for the caller (leave / remove-from-my-inbox). dm/group
--    stamp the participant row; channels upsert a read-state row so auto-listed
--    room + org_team channels can be hidden too.
create or replace function public.hide_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind is null then raise exception 'conversation not found'; end if;
  if v_kind = 'channel' then
    insert into public.channel_read_state (conversation_id, user_id, hidden_at)
      values (p_conversation_id, auth.uid(), now())
      on conflict (conversation_id, user_id) do update set hidden_at = excluded.hidden_at;
  else
    update public.conversation_participants set hidden_at = now()
      where conversation_id = p_conversation_id and user_id = auth.uid();
  end if;
end; $$;
grant execute on function public.hide_conversation(uuid) to authenticated;

-- 3. Delete a conversation for EVERYONE — creator, team admin, or (org_team
--    channels) org_team lead. Room channels are off-limits (they belong to the
--    room). FKs cascade messages/participants/read-state.
create or replace function public.delete_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'conversation not found'; end if;
  if c.room_id is not null then raise exception 'room channels cannot be deleted'; end if;
  if not (
    c.created_by = auth.uid()
    or (c.team_id is not null and exists (
         select 1 from public.team_members tm
          where tm.team_id = c.team_id and tm.user_id = auth.uid() and tm.role = 'admin'))
    or (c.org_team_id is not null and exists (
         select 1 from public.org_team_members otm
          where otm.org_team_id = c.org_team_id and otm.user_id = auth.uid() and otm.role = 'lead'))
  ) then
    raise exception 'not allowed to delete this conversation';
  end if;
  delete from public.conversations where id = p_conversation_id;
end; $$;
grant execute on function public.delete_conversation(uuid) to authenticated;

-- 4. Inbox: same as room_channels_unify, plus (a) it drops rows the caller has
--    hidden UNTIL a newer message arrives (hidden_at threshold) and (b) it
--    returns created_by + room_id so the client can decide whether "Delete for
--    everyone" or "Leave" is the right action per row.
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid, kind text, title text, last_message_at timestamptz, last_read_at timestamptz,
  participant_ids uuid[], org_team_id uuid, org_team_color text, org_ids uuid[],
  pinned_at timestamptz, muted_at timestamptz, topic text, post_policy text,
  created_by uuid, room_id uuid
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
    c.created_by, c.room_id
  from dm_acc a join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid left join scoped s on s.cid = a.cid
  where a.hidden_at is null or c.last_message_at > a.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy, c.created_by, c.room_id
  from chan_acc ca join public.conversations c on c.id = ca.cid
  where ca.hidden_at is null or c.last_message_at > ca.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy, c.created_by, c.room_id
  from chan_open co join public.conversations c on c.id = co.cid
  where co.hidden_at is null or c.last_message_at > co.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, cr.last_read_at,
    '{}'::uuid[], cr.org_team_id, cr.org_team_color, array[cr.org_id],
    cr.pinned_at, cr.muted_at, c.topic, c.post_policy, c.created_by, c.room_id
  from chan_room cr join public.conversations c on c.id = cr.cid
  where cr.hidden_at is null or c.last_message_at > cr.hidden_at
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
