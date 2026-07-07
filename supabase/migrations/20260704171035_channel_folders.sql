-- Shared, team-wide folders for organising channels. Admin-curated: every team
-- member SEES the same folders + channel groupings; team admins create / rename /
-- delete / reorder folders and file channels into them. A channel carries a
-- single shared folder_id (folders live per org `team`), so the grouping is the
-- same for everyone.
--
-- Fresh timestamp — depends on 20260704170000 (list_my_conversations shape).

create table if not exists public.channel_folders (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  position   int  not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists channel_folders_team_idx on public.channel_folders (team_id, position);
alter table public.channel_folders enable row level security;

-- Any member of the team can read its folder list; writes go through the
-- admin-gated RPCs below (no direct write policy).
drop policy if exists "team members read channel folders" on public.channel_folders;
create policy "team members read channel folders" on public.channel_folders
  for select using (exists (
    select 1 from public.team_members tm
     where tm.team_id = channel_folders.team_id and tm.user_id = auth.uid()));

-- A channel's (shared) folder assignment. Cleared automatically if the folder
-- is deleted.
alter table public.conversations
  add column if not exists folder_id uuid references public.channel_folders(id) on delete set null;

-- ── Admin gate + folder CRUD (SECURITY DEFINER) ──
create or replace function public.create_channel_folder(p_team_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  if not exists (select 1 from public.team_members tm where tm.team_id = p_team_id and tm.user_id = auth.uid() and tm.role = 'admin') then
    raise exception 'only a team admin can manage channel folders';
  end if;
  insert into public.channel_folders (team_id, name, position, created_by)
    values (p_team_id, coalesce(nullif(trim(p_name), ''), 'Folder'),
            coalesce((select max(position) + 1 from public.channel_folders where team_id = p_team_id), 0), auth.uid())
    returning id into fid;
  return fid;
end; $$;
grant execute on function public.create_channel_folder(uuid, text) to authenticated;

create or replace function public.rename_channel_folder(p_folder_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid;
begin
  select team_id into v_team from public.channel_folders where id = p_folder_id;
  if v_team is null then raise exception 'folder not found'; end if;
  if not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.user_id = auth.uid() and tm.role = 'admin') then
    raise exception 'only a team admin can manage channel folders';
  end if;
  update public.channel_folders set name = coalesce(nullif(trim(p_name), ''), name) where id = p_folder_id;
end; $$;
grant execute on function public.rename_channel_folder(uuid, text) to authenticated;

create or replace function public.delete_channel_folder(p_folder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid;
begin
  select team_id into v_team from public.channel_folders where id = p_folder_id;
  if v_team is null then return; end if;
  if not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.user_id = auth.uid() and tm.role = 'admin') then
    raise exception 'only a team admin can manage channel folders';
  end if;
  delete from public.channel_folders where id = p_folder_id;  -- channels.folder_id → null (FK)
end; $$;
grant execute on function public.delete_channel_folder(uuid) to authenticated;

create or replace function public.reorder_channel_folders(p_folder_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid;
begin
  if p_folder_ids is null or array_length(p_folder_ids, 1) is null then return; end if;
  select team_id into v_team from public.channel_folders where id = p_folder_ids[1];
  if v_team is null then return; end if;
  if not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.user_id = auth.uid() and tm.role = 'admin') then
    raise exception 'only a team admin can manage channel folders';
  end if;
  update public.channel_folders f set position = x.ord
    from (select id, (ord - 1) as ord from unnest(p_folder_ids) with ordinality as t(id, ord)) x
   where f.id = x.id and f.team_id = v_team;
end; $$;
grant execute on function public.reorder_channel_folders(uuid[]) to authenticated;

-- File a channel into a folder (or null to remove). Admin of the channel's team;
-- the folder (when set) must belong to that same team.
create or replace function public.set_channel_folder(p_conversation_id uuid, p_folder_id uuid)
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
end; $$;
grant execute on function public.set_channel_folder(uuid, uuid) to authenticated;

-- ── Inbox: same as 20260704170000 plus folder_id per row ──
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid, kind text, title text, last_message_at timestamptz, last_read_at timestamptz,
  participant_ids uuid[], org_team_id uuid, org_team_color text, org_ids uuid[],
  pinned_at timestamptz, muted_at timestamptz, topic text, post_policy text,
  created_by uuid, room_id uuid, folder_id uuid
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
    c.created_by, c.room_id, c.folder_id
  from dm_acc a join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid left join scoped s on s.cid = a.cid
  where a.hidden_at is null or c.last_message_at > a.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[], ca.org_team_id, ca.org_team_color, array[ca.org_id],
    ca.pinned_at, ca.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id
  from chan_acc ca join public.conversations c on c.id = ca.cid
  where ca.hidden_at is null or c.last_message_at > ca.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, co.last_read_at,
    '{}'::uuid[], co.org_team_id, co.org_team_color, array[co.org_id],
    co.pinned_at, co.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id
  from chan_open co join public.conversations c on c.id = co.cid
  where co.hidden_at is null or c.last_message_at > co.hidden_at
  union all
  select c.id, c.kind, c.title, c.last_message_at, cr.last_read_at,
    '{}'::uuid[], cr.org_team_id, cr.org_team_color, array[cr.org_id],
    cr.pinned_at, cr.muted_at, c.topic, c.post_policy, c.created_by, c.room_id, c.folder_id
  from chan_room cr join public.conversations c on c.id = cr.cid
  where cr.hidden_at is null or c.last_message_at > cr.hidden_at
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
