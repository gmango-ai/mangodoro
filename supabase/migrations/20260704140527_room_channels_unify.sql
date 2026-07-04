-- Stage 2 (rooms↔channels): unify in-room chat onto the messaging backend.
--
-- Every GENERAL room gets a channel (kind='channel', room_id set, team_id = the
-- room's team, visibility='org') that auto-lists for the team in Messages. Its
-- existing chat_messages are backfilled into dm_messages, so the in-room chat
-- panel and the Messages channel are literally the same thread once the client
-- reads/writes the channel.
--
-- ⚠️ IRREVERSIBLE: the DO block copies live chat_messages history into
-- dm_messages. It is idempotent (skips rooms already linked), but re-running
-- after a partial link is not a concern because linking + copy happen together
-- per room. meeting/private rooms stay ephemeral (no channel).
--
-- Fresh timestamp (latest applied on the shared DB is 20260704140000).

-- 1. Link a conversation to a room (one channel per room).
alter table public.conversations
  add column if not exists room_id uuid unique references public.rooms(id) on delete cascade;

-- 2. Ensure-a-room-channel (idempotent) — used lazily by the client too.
create or replace function public.get_or_create_room_channel(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; cid uuid;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.kind <> 'general' then raise exception 'only general rooms have a channel'; end if;
  if not exists (select 1 from public.team_members tm
                  where tm.team_id = v_room.team_id and tm.user_id = auth.uid()) then
    raise exception 'not a member of this room''s team';
  end if;
  select id into cid from public.conversations where room_id = p_room_id;
  if cid is not null then return cid; end if;
  insert into public.conversations (team_id, is_group, kind, org_team_id, room_id, title, created_by, visibility)
    values (v_room.team_id, false, 'channel', null, p_room_id, v_room.name,
            coalesce(v_room.created_by, auth.uid()), 'org')
    returning id into cid;
  return cid;
end; $$;
grant execute on function public.get_or_create_room_channel(uuid) to authenticated;

-- 3. Backfill: link every general room + copy its chat history (idempotent).
do $$
declare r record; cid uuid;
begin
  for r in select * from public.rooms where kind = 'general' and archived_at is null loop
    select id into cid from public.conversations where room_id = r.id;
    if cid is null then
      insert into public.conversations (team_id, is_group, kind, org_team_id, room_id, title, created_by, visibility)
        values (r.team_id, false, 'channel', null, r.id, r.name, r.created_by, 'org')
        returning id into cid;
      insert into public.dm_messages (conversation_id, sender_id, body, created_at, edited_at, deleted_at)
        select cid, cm.user_id, cm.body, cm.created_at, cm.edited_at, cm.deleted_at
          from public.chat_messages cm
         where cm.room_id = r.id
         order by cm.created_at asc;
      update public.conversations c
        set last_message_at = coalesce(
              (select max(created_at) from public.dm_messages where conversation_id = cid),
              c.last_message_at)
        where c.id = cid;
    end if;
  end loop;
end $$;

-- 4. Auto-create a channel for every new general room, and keep its title synced.
create or replace function public.tg_room_create_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'general' then
    insert into public.conversations (team_id, is_group, kind, org_team_id, room_id, title, created_by, visibility)
      values (new.team_id, false, 'channel', null, new.id, new.name, new.created_by, 'org')
      on conflict (room_id) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists tr_room_create_channel on public.rooms;
create trigger tr_room_create_channel after insert on public.rooms
  for each row execute function public.tg_room_create_channel();

create or replace function public.tg_room_sync_channel_title()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.conversations set title = new.name where room_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists tr_room_sync_channel_title on public.rooms;
create trigger tr_room_sync_channel_title after update on public.rooms
  for each row execute function public.tg_room_sync_channel_title();

-- 5. Browse excludes room channels (they auto-list for the team).
create or replace function public.list_joinable_channels()
returns table (id uuid, title text, topic text, team_id uuid, member_count bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.topic, c.team_id,
    (select count(*) from public.channel_read_state crs where crs.conversation_id = c.id)
  from public.conversations c
  where c.kind = 'channel' and c.visibility = 'org' and c.room_id is null
    and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = auth.uid())
    and not exists (select 1 from public.channel_read_state crs
                     where crs.conversation_id = c.id and crs.user_id = auth.uid())
  order by c.last_message_at desc nulls last;
$$;
grant execute on function public.list_joinable_channels() to authenticated;

-- 6. Inbox: auto-list room channels for the room's team (chan_room), keep
-- org_team channels (chan_acc) and joined open channels (chan_open, non-room).
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
     where c.kind = 'channel' and c.visibility = 'org' and c.room_id is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
  ),
  chan_room as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, r.color as org_team_color,
           crs.last_read_at, crs.pinned_at, crs.muted_at
      from public.conversations c
      join public.rooms r on r.id = c.room_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and c.room_id is not null and r.archived_at is null
       and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.user_id = (select uid from me))
  )
  select c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]), null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[]), a.pinned_at, a.muted_at, c.topic, c.post_policy
  from dm_acc a join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid left join scoped s on s.cid = a.cid
  union all
  select c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy
  from chan_acc ca join public.conversations c on c.id = ca.cid
  union all
  select c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy
  from chan_open co join public.conversations c on c.id = co.cid
  union all
  select c.id, c.kind, c.title, c.last_message_at, cr.last_read_at,
    '{}'::uuid[], cr.org_team_id, cr.org_team_color, array[cr.org_id],
    cr.pinned_at, cr.muted_at, c.topic, c.post_policy
  from chan_room cr join public.conversations c on c.id = cr.cid
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

-- 7. Clear-room-chat now redacts the unified channel (dm_messages) too. Same
-- manager gate as before (creator / org admin / gating-team lead).
create or replace function public.clear_room_chat(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid; v_team_id uuid; v_cid uuid;
begin
  select created_by, team_id into v_creator, v_team_id from public.rooms where id = p_room_id;
  if v_creator is null then raise exception 'Room not found'; end if;
  if not (
    v_creator = auth.uid()
    or exists (select 1 from public.team_members tm
                where tm.team_id = v_team_id and tm.user_id = auth.uid() and tm.role = 'admin')
    or exists (select 1 from public.room_teams rt
                join public.org_team_members otm on otm.org_team_id = rt.org_team_id
                where rt.room_id = p_room_id and otm.user_id = auth.uid() and otm.role = 'lead')
  ) then
    raise exception 'You do not have permission to clear this room''s chat';
  end if;
  update public.chat_messages set deleted_at = now() where room_id = p_room_id and deleted_at is null;
  select id into v_cid from public.conversations where room_id = p_room_id;
  if v_cid is not null then
    update public.dm_messages set deleted_at = now() where conversation_id = v_cid and deleted_at is null;
  end if;
end; $$;
grant execute on function public.clear_room_chat(uuid) to authenticated;

notify pgrst, 'reload schema';
