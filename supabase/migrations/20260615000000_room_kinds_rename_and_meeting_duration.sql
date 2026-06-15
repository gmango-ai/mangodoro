-- Room model reshape:
--   1. Rename the 'department' kind to 'general' (it's just the team's
--      default catch-all room, not necessarily a department concept).
--   2. Meeting rooms get an optional max_duration_minutes — when a
--      sync_session attaches to such a room, expires_at is computed
--      automatically and a scheduled sweep closes it.
--   3. Private rooms start UNLOCKED (no invite_code at create time).
--      The first sync_session in a private room mints the code and
--      writes it back to the room, "locking" it for everyone else.

-- ── 1. Rename department → general ─────────────────────────────────
alter type public.room_kind rename value 'department' to 'general';

-- ── 2. Meeting max-duration ────────────────────────────────────────
alter table public.rooms
  add column if not exists max_duration_minutes int
  check (max_duration_minutes is null or max_duration_minutes > 0);

alter table public.rooms drop constraint if exists rooms_max_duration_meeting_only;
alter table public.rooms add constraint rooms_max_duration_meeting_only
  check (max_duration_minutes is null or kind = 'meeting');

-- Sync sessions get an expiration timestamp (NULL = no expiry / not a
-- meeting room session).
alter table public.sync_sessions
  add column if not exists expires_at timestamptz;

create index if not exists sync_sessions_expires_at_active_idx
  on public.sync_sessions (expires_at)
  where status = 'active' and expires_at is not null;

-- ── 3. Private rooms unlocked-until-joined ─────────────────────────
-- Old constraint: (kind = 'private') = (invite_code is not null) — i.e.
-- private MUST have a code and non-private MUST NOT. Replace with:
-- invite_code can only exist on private rooms, but private rooms may
-- have a null code (unlocked) until the first session locks it.
alter table public.rooms drop constraint if exists rooms_private_requires_code;
alter table public.rooms add constraint rooms_invite_code_only_private
  check (invite_code is null or kind = 'private');

-- ── 4. Update the "every new team gets a General room" trigger ─────
create or replace function public.create_default_room_for_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rooms (team_id, name, kind, created_by)
  values (new.id, 'General', 'general', new.created_by);
  return new;
end;
$$;

-- ── 5. Side-effect trigger on sync_sessions ────────────────────────
-- On INSERT of a session attached to a room:
--   • Meeting room with max_duration_minutes → set expires_at.
--   • Private room with NULL invite_code → mint a code and write it
--     back to the room (this is what "locks" the private room after
--     first join).
create or replace function public.sync_session_room_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_code text;
begin
  if new.room_id is null then return new; end if;
  select * into v_room from public.rooms where id = new.room_id;
  if v_room is null then return new; end if;

  -- Auto-expire for meeting rooms
  if v_room.kind = 'meeting'
     and v_room.max_duration_minutes is not null
     and new.expires_at is null then
    new.expires_at := pg_catalog.now()
                    + (v_room.max_duration_minutes * interval '1 minute');
  end if;

  -- Lock private rooms on first join. Retry-friendly: if the code we
  -- generate collides with another room's, the unique index throws and
  -- the caller can retry the join.
  if v_room.kind = 'private' and v_room.invite_code is null then
    v_code := upper(substr(
      translate(encode(pg_catalog.gen_random_bytes(8), 'base64'),
                '+/=', ''),
      1, 6));
    update public.rooms set invite_code = v_code where id = v_room.id;
  end if;

  return new;
end;
$$;

drop trigger if exists tr_sync_session_room_side_effects on public.sync_sessions;
create trigger tr_sync_session_room_side_effects
  before insert on public.sync_sessions
  for each row execute function public.sync_session_room_side_effects();

-- ── 6. Auto-close expired meeting sessions ─────────────────────────
-- Called whenever sync_sessions is queried (cheap function, plays well
-- with Realtime + ad-hoc selects). If pg_cron is available the deploy
-- can also wire `select public.sweep_expired_sync_sessions()` every
-- minute for tighter granularity.
create or replace function public.sweep_expired_sync_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with closed as (
    update public.sync_sessions
       set status = 'ended',
           ended_at = pg_catalog.now(),
           is_running = false
     where status = 'active'
       and expires_at is not null
       and expires_at <= pg_catalog.now()
     returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

grant execute on function public.sweep_expired_sync_sessions() to authenticated;

-- ── 7. create_room_v2 rewrite ──────────────────────────────────────
-- Adds:
--   • p_max_duration_minutes (only honored for meeting kind)
--   • auto-placement: when p_layout_x / p_layout_y are NULL, scan the
--     team's existing rooms and pick the first non-overlapping cell.
-- Drops:
--   • p_invite_code (private rooms no longer get a code at create
--     time; the sync_session trigger mints + locks on first join).
drop function if exists public.create_room_v2(uuid, text, text, uuid[], text, int, int, int, int, text);

create or replace function public.create_room_v2(
  p_team_id uuid,
  p_name text,
  p_kind text,
  p_org_team_ids uuid[] default array[]::uuid[],
  p_layout_x int default null,
  p_layout_y int default null,
  p_layout_w int default 4,
  p_layout_h int default 2,
  p_color text default '#14b8a6',
  p_max_duration_minutes int default null
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
  v_room_id uuid;
  v_clean_name text := trim(p_name);
  v_gating uuid[] := coalesce(p_org_team_ids, array[]::uuid[]);
  v_w int := greatest(1, least(12, coalesce(p_layout_w, 4)));
  v_h int := greatest(1, least(12, coalesce(p_layout_h, 2)));
  v_x int;
  v_y int;
  v_cols constant int := 12;
  v_scan_y int;
  v_scan_x int;
  v_collision boolean;
begin
  if v_clean_name = '' then raise exception 'Room name is required'; end if;

  select bool_or(role = 'admin'), bool_or(true)
  into v_is_admin, v_is_member
  from public.team_members
  where team_id = p_team_id and user_id = auth.uid();

  if not coalesce(v_is_member, false) then
    raise exception 'You must be a member of this org to create a room';
  end if;
  if v_kind = 'general' and not v_is_admin then
    raise exception 'Only org admins can create general rooms';
  end if;
  if p_max_duration_minutes is not null and v_kind <> 'meeting' then
    raise exception 'Only meeting rooms can have a max duration';
  end if;
  if not v_is_admin and array_length(v_gating, 1) is not null then
    if exists (
      select 1 from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_team_members
        where org_team_id = t.id and user_id = auth.uid() and role = 'lead'
      )
    ) then raise exception 'You may only gate a room to teams you lead'; end if;
  end if;
  if array_length(v_gating, 1) is not null then
    if exists (
      select 1 from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_teams
        where id = t.id and org_id = p_team_id and archived_at is null
      )
    ) then raise exception 'A gating team does not belong to this org'; end if;
  end if;

  -- Auto-placement when caller doesn't specify a position. Row-major
  -- scan, first w×h cell with no overlap wins. Capped at 50 rows so
  -- a totally-full grid still returns instead of looping forever.
  if p_layout_x is null or p_layout_y is null then
    v_scan_y := 0;
    <<outer>> while v_scan_y < 50 loop
      v_scan_x := 0;
      while v_scan_x <= v_cols - v_w loop
        select exists (
          select 1 from public.rooms r
          where r.team_id = p_team_id
            and r.archived_at is null
            and r.layout_x < v_scan_x + v_w
            and r.layout_x + r.layout_w > v_scan_x
            and r.layout_y < v_scan_y + v_h
            and r.layout_y + r.layout_h > v_scan_y
        ) into v_collision;
        if not v_collision then
          v_x := v_scan_x; v_y := v_scan_y;
          exit outer;
        end if;
        v_scan_x := v_scan_x + 1;
      end loop;
      v_scan_y := v_scan_y + 1;
    end loop;
    if v_x is null then v_x := 0; v_y := 50; end if;
  else
    v_x := greatest(0, least(24, p_layout_x));
    v_y := greatest(0, least(50, p_layout_y));
  end if;

  insert into public.rooms
    (team_id, name, kind, invite_code, created_by, color,
     layout_x, layout_y, layout_w, layout_h, max_duration_minutes)
  values
    (p_team_id, v_clean_name, v_kind, null, auth.uid(),
     coalesce(p_color, '#14b8a6'),
     v_x, v_y, v_w, v_h,
     case when v_kind = 'meeting' then p_max_duration_minutes else null end)
  returning id into v_room_id;

  if array_length(v_gating, 1) is not null then
    insert into public.room_teams (room_id, org_team_id)
    select v_room_id, t.id from unnest(v_gating) as t(id);
  end if;

  return v_room_id;
end;
$$;

grant execute on function public.create_room_v2(uuid, text, text, uuid[], int, int, int, int, text, int) to authenticated;

-- ── 8. Update RLS for the renamed kind ─────────────────────────────
-- The old "Admins can create department rooms" policy referenced the
-- old enum value. Refresh it with the new spelling.
drop policy if exists "Admins can create department rooms" on public.rooms;
create policy "Admins can create general rooms"
  on public.rooms for insert
  with check (
    kind = 'general'
    and created_by = auth.uid()
    and exists (
      select 1 from public.team_members
      where team_id = rooms.team_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );
