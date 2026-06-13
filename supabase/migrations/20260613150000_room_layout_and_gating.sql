-- Office layout + multi-team room gating.
--
-- This migration introduces two capabilities:
--   1. Spatial layout: each room carries (x, y, w, h) cells so admins
--      can arrange a virtual office floor plan. Defaults keep existing
--      rooms valid without backfill work.
--   2. Multi-team gating: a new `room_teams` junction table associates
--      a room with one or more org_teams. If no rows exist for a room,
--      it stays org-wide; otherwise visibility is restricted to org
--      members whose org_team membership intersects.
--
-- All writes on `rooms` (other than the security-definer trigger and
-- direct admin writes) flow through new RPCs below. This matches the
-- pattern used elsewhere in the schema (set_member_hr, set_retro_live)
-- and avoids the RLS-recursion footgun (see
-- 20260519140000_fix_rls_recursion.sql and the sync-open fix).

-- ── 1. Layout columns ─────────────────────────────────────────────

alter table public.rooms
  add column if not exists layout_x int not null default 0,
  add column if not exists layout_y int not null default 0,
  add column if not exists layout_w int not null default 2,
  add column if not exists layout_h int not null default 2;

-- ── 2. Junction table ─────────────────────────────────────────────

create table if not exists public.room_teams (
  room_id uuid not null references public.rooms(id) on delete cascade,
  org_team_id uuid not null references public.org_teams(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (room_id, org_team_id)
);

create index if not exists room_teams_room_idx on public.room_teams (room_id);
create index if not exists room_teams_org_team_idx on public.room_teams (org_team_id);

alter table public.room_teams replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.room_teams;
exception when duplicate_object then null;
end $$;

-- ── 3. RLS on room_teams ──────────────────────────────────────────
-- Read: any org member can see gating rows for rooms in their org.
-- Write: blocked at the policy level; force callers through RPCs.

alter table public.room_teams enable row level security;

drop policy if exists "Org members read room_teams" on public.room_teams;
create policy "Org members read room_teams"
  on public.room_teams for select
  using (
    exists (
      select 1
      from public.rooms r
      join public.team_members tm on tm.team_id = r.team_id
      where r.id = room_teams.room_id and tm.user_id = auth.uid()
    )
  );

-- No insert/update/delete policies — writes flow through the
-- security-definer RPCs declared below.

-- ── 4. Rewrite rooms write policies ───────────────────────────────
-- Drop the four legacy write policies and replace with a single
-- "Direct writes only for org admins" fallback. Everything else
-- (team leads, room creators acting on their own rooms) routes through
-- RPCs that encode the richer permission model.

drop policy if exists "Admins can create department rooms" on public.rooms;
drop policy if exists "Members can create meeting or private rooms" on public.rooms;
drop policy if exists "Creators or admins can update rooms" on public.rooms;
drop policy if exists "Creators or admins can delete rooms" on public.rooms;

drop policy if exists "Org admins can directly write rooms" on public.rooms;
create policy "Org admins can directly write rooms"
  on public.rooms for all
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── 5. Helpers ────────────────────────────────────────────────────

-- Predicate: is the caller an admin of the org owning the given room?
create or replace function public.is_org_admin_of_room(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.team_members tm on tm.team_id = r.team_id
    where r.id = p_room_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  );
$$;

grant execute on function public.is_org_admin_of_room(uuid) to authenticated;

-- Predicate: is the caller a lead of ANY team currently gating this
-- room? Used by update_room_layout and archive_room_v2.
create or replace function public.is_lead_of_any_gating_team(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_teams rt
    join public.org_team_members otm on otm.org_team_id = rt.org_team_id
    where rt.room_id = p_room_id
      and otm.user_id = auth.uid()
      and otm.role = 'lead'
  );
$$;

grant execute on function public.is_lead_of_any_gating_team(uuid) to authenticated;

-- ── 6. create_room_v2 ────────────────────────────────────────────
-- Replaces direct INSERTs from the client. Encodes the full rule set:
--   * org admins may create any kind with any gating
--   * org_team leads may create rooms gated to teams they lead (only)
--   * regular org members may create non-department rooms with NO
--     team gating (preserves "anyone can spin up a meeting" behavior)

create or replace function public.create_room_v2(
  p_team_id uuid,
  p_name text,
  p_kind text,
  p_org_team_ids uuid[] default array[]::uuid[],
  p_invite_code text default null,
  p_layout_x int default 0,
  p_layout_y int default 0,
  p_layout_w int default 2,
  p_layout_h int default 2
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_is_member boolean;
  v_kind public.room_kind := p_kind::public.room_kind;
  v_team uuid;
  v_room_id uuid;
  v_clean_name text := trim(p_name);
  v_gating uuid[] := coalesce(p_org_team_ids, array[]::uuid[]);
begin
  if v_clean_name = '' then
    raise exception 'Room name is required';
  end if;

  -- Membership + role within this org.
  select
    bool_or(role = 'admin'),
    bool_or(true)
  into v_is_admin, v_is_member
  from public.team_members
  where team_id = p_team_id and user_id = auth.uid();

  if not coalesce(v_is_member, false) then
    raise exception 'You must be a member of this org to create a room';
  end if;

  -- Non-admins cannot create department rooms (admin-curated kind).
  if v_kind = 'department' and not v_is_admin then
    raise exception 'Only org admins can create department rooms';
  end if;

  -- Non-admins with gating teams: must lead every team they're gating
  -- the room to. Empty gating = org-wide, which is always allowed for
  -- meeting/private kinds.
  if not v_is_admin and array_length(v_gating, 1) is not null then
    if exists (
      select 1
      from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_team_members
        where org_team_id = t.id and user_id = auth.uid() and role = 'lead'
      )
    ) then
      raise exception 'You may only gate a room to teams you lead';
    end if;
  end if;

  -- All gating teams must belong to this org.
  if array_length(v_gating, 1) is not null then
    if exists (
      select 1 from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_teams
        where id = t.id and org_id = p_team_id and archived_at is null
      )
    ) then
      raise exception 'A gating team does not belong to this org';
    end if;
  end if;

  -- Insert the room then the junction rows in one statement-time tx.
  insert into public.rooms
    (team_id, name, kind, invite_code, created_by,
     layout_x, layout_y, layout_w, layout_h)
  values
    (p_team_id, v_clean_name, v_kind, p_invite_code, auth.uid(),
     greatest(0, least(24, p_layout_x)),
     greatest(0, least(24, p_layout_y)),
     greatest(1, least(12, p_layout_w)),
     greatest(1, least(12, p_layout_h)))
  returning id into v_room_id;

  if array_length(v_gating, 1) is not null then
    insert into public.room_teams (room_id, org_team_id)
    select v_room_id, t.id from unnest(v_gating) as t(id);
  end if;

  return v_room_id;
end;
$$;

grant execute on function public.create_room_v2(uuid, text, text, uuid[], text, int, int, int, int) to authenticated;

-- ── 7. update_room_layout ────────────────────────────────────────
-- Admin OR lead of any gating team OR creator may move/resize.

create or replace function public.update_room_layout(
  p_room_id uuid,
  p_x int,
  p_y int,
  p_w int,
  p_h int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;

  if not (
    public.is_org_admin_of_room(p_room_id)
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to move this room';
  end if;

  update public.rooms
  set
    layout_x = greatest(0, least(24, p_x)),
    layout_y = greatest(0, least(24, p_y)),
    layout_w = greatest(1, least(12, p_w)),
    layout_h = greatest(1, least(12, p_h))
  where id = p_room_id;
end;
$$;

grant execute on function public.update_room_layout(uuid, int, int, int, int) to authenticated;

-- ── 8. update_room_gating ────────────────────────────────────────
-- Replace the set of gating teams for a room. To avoid a lead locking
-- themselves out, we check the UNION of current + proposed teams: the
-- caller must lead at least one team across both states (or be admin
-- or the room creator).

create or replace function public.update_room_gating(
  p_room_id uuid,
  p_org_team_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_room_team_id uuid;
  v_gating uuid[] := coalesce(p_org_team_ids, array[]::uuid[]);
begin
  select created_by, team_id into v_creator, v_room_team_id
    from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;

  -- Validate every proposed team belongs to this org and isn't archived.
  if array_length(v_gating, 1) is not null then
    if exists (
      select 1 from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_teams
        where id = t.id and org_id = v_room_team_id and archived_at is null
      )
    ) then
      raise exception 'A gating team does not belong to this org';
    end if;
  end if;

  if not (
    public.is_org_admin_of_room(p_room_id)
    or v_creator = auth.uid()
    -- Lead of any team in current OR proposed gating sets.
    or exists (
      select 1
      from public.org_team_members otm
      where otm.user_id = auth.uid()
        and otm.role = 'lead'
        and (
          otm.org_team_id in (
            select org_team_id from public.room_teams where room_id = p_room_id
          )
          or otm.org_team_id = any(v_gating)
        )
    )
  ) then
    raise exception 'You do not have permission to change this room''s gating';
  end if;

  delete from public.room_teams where room_id = p_room_id;
  if array_length(v_gating, 1) is not null then
    insert into public.room_teams (room_id, org_team_id)
    select p_room_id, t.id from unnest(v_gating) as t(id);
  end if;
end;
$$;

grant execute on function public.update_room_gating(uuid, uuid[]) to authenticated;

-- ── 9. archive_room_v2 ───────────────────────────────────────────
-- Soft-delete: sets archived_at. Admin OR lead of any gating team OR
-- creator. Idempotent on already-archived rooms.

create or replace function public.archive_room_v2(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;

  if not (
    public.is_org_admin_of_room(p_room_id)
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to archive this room';
  end if;

  update public.rooms
  set archived_at = now()
  where id = p_room_id and archived_at is null;
end;
$$;

grant execute on function public.archive_room_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
