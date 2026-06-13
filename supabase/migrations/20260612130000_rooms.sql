-- Rooms: persistent pomodoro spaces within a team.
--
-- A team has many rooms; each room hosts at most one active sync_session.
-- Three kinds:
--   * 'department' — admin-curated long-lived rooms (SWE, PM, HR, etc.)
--   * 'meeting'    — anyone in the team can spin one up for an ad-hoc meeting
--   * 'private'    — invite-code gated; visible to the team (with a lock
--                    icon) but joinable only with the code
--
-- Existing sync_sessions stay loose (room_id null) for back-compat; new
-- sessions started "in a room" carry the room_id so the UI can group them.

-- Guarded with a DO block — `create type` has no native `if not exists`,
-- so a partial prior run that created the enum would otherwise break
-- re-runs of the whole migration.
do $$
begin
  create type public.room_kind as enum ('department', 'meeting', 'private');
exception when duplicate_object then null;
end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  kind public.room_kind not null,
  invite_code text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Private rooms must have an invite code; other kinds shouldn't.
  constraint rooms_private_requires_code
    check ((kind = 'private') = (invite_code is not null))
);

create index if not exists rooms_team_id_idx on public.rooms (team_id) where archived_at is null;
create unique index if not exists rooms_invite_code_unique
  on public.rooms (invite_code) where invite_code is not null;

alter table public.rooms replica identity full;
-- Realtime publication add is idempotent in newer Postgres but errors on
-- duplicate in older — guard it.
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

-- Link sync sessions to a room (nullable: existing loose sessions keep working).
alter table public.sync_sessions
  add column if not exists room_id uuid references public.rooms(id) on delete set null;
create index if not exists sync_sessions_room_active
  on public.sync_sessions (room_id) where status = 'active';
-- At most one active session per room.
create unique index if not exists sync_sessions_one_active_per_room
  on public.sync_sessions (room_id)
  where status = 'active' and room_id is not null;

-- RLS

alter table public.rooms enable row level security;

-- `create policy` has no `if not exists`. Drop + create makes the
-- migration safely re-runnable after a partial prior run.
drop policy if exists "Team members can read rooms" on public.rooms;
create policy "Team members can read rooms"
  on public.rooms for select
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

drop policy if exists "Admins can create department rooms" on public.rooms;
create policy "Admins can create department rooms"
  on public.rooms for insert
  with check (
    kind = 'department'
    and created_by = auth.uid()
    and team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Members can create meeting or private rooms" on public.rooms;
create policy "Members can create meeting or private rooms"
  on public.rooms for insert
  with check (
    kind in ('meeting', 'private')
    and created_by = auth.uid()
    and team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

drop policy if exists "Creators or admins can update rooms" on public.rooms;
create policy "Creators or admins can update rooms"
  on public.rooms for update
  using (
    created_by = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Creators or admins can delete rooms" on public.rooms;
create policy "Creators or admins can delete rooms"
  on public.rooms for delete
  using (
    created_by = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Auto-create a "General" department room whenever a team is created.
-- Security definer because the inserting user isn't yet listed as an admin
-- in team_members (the app inserts the membership row immediately after
-- the team row, in a separate request), so the insert policy would block.

create or replace function public.create_default_room_for_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rooms (team_id, name, kind, created_by)
  values (new.id, 'General', 'department', new.created_by);
  return new;
end;
$$;

drop trigger if exists tr_teams_create_default_room on public.teams;
create trigger tr_teams_create_default_room
  after insert on public.teams
  for each row
  execute function public.create_default_room_for_team();

-- Backfill: every existing team gets a General room.
insert into public.rooms (team_id, name, kind, created_by)
select t.id, 'General', 'department', t.created_by
from public.teams t
where not exists (
  select 1 from public.rooms r
  where r.team_id = t.id and r.kind = 'department' and r.name = 'General'
);

-- RPC: resolve a room invite code to a room_id, after verifying the caller
-- is in the room's team. Security definer so the code lookup itself doesn't
-- leak room existence to non-members of unrelated teams.
create or replace function public.resolve_room_by_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  select * into v_room
    from public.rooms
    where invite_code = upper(trim(p_code))
      and archived_at is null;
  if v_room is null then
    raise exception 'Invalid room code';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = v_room.team_id and user_id = auth.uid()
  ) then
    raise exception 'You must be on the team to join this room';
  end if;
  return v_room.id;
end;
$$;

grant execute on function public.resolve_room_by_invite_code(text) to authenticated;

notify pgrst, 'reload schema';
