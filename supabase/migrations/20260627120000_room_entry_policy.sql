-- Room privacy, Phase 0 — make "private" actually enforce.
--
-- Before this migration, room privacy was client-side theater:
--   • start_or_join_room_session / join_sync_session performed NO access
--     check, so anyone could call the RPC directly and walk in.
--   • the per-room invite_code lived on the rooms row, which the SELECT
--     policy returns whole — so the "secret" was readable by every team
--     member.
--   • the code was minted on first join and cleared when the room emptied,
--     so the first person was always ungated and a live session auto-joined
--     anyone with the URL.
--
-- This migration introduces a server-enforced entry policy:
--   • rooms.entry_policy: 'open' (any team member) | 'code' (PIN required).
--   • room_secrets: the PIN, in a table only the room's managers can read
--     (owner / org admin / gating-team lead) — never the whole org.
--   • can_enter_room(): the single source of truth, called by BOTH join
--     RPCs so a direct call can't bypass it.
-- Existing private rooms are converted to 'code' with a freshly minted,
-- persistent, shareable PIN. The old invite_code mechanism is retired.

-- ── 1. entry policy enum + column ──────────────────────────────────
do $$ begin
  create type public.room_entry_policy as enum ('open', 'code');
exception
  when duplicate_object then null;
end $$;

alter table public.rooms
  add column if not exists entry_policy public.room_entry_policy not null default 'open';

-- ── 2. room_secrets: the PIN, readable only by room managers ───────
-- Writes go through set_room_access_code (security definer), so there are
-- NO client write policies — a member can't forge or overwrite a code.
-- The verify path (can_enter_room) is security definer and reads it
-- regardless of these policies.
create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  code text not null,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);

alter table public.room_secrets enable row level security;

drop policy if exists "room managers read secrets" on public.room_secrets;
create policy "room managers read secrets" on public.room_secrets for select
  using (
    public.is_org_admin_of_room(room_id)
    or public.is_lead_of_any_gating_team(room_id)
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.created_by = auth.uid()
    )
  );

-- ── 3. can_enter_room: the single enforcement point ────────────────
-- Returns 'allowed' | 'denied'. Security definer so it can read
-- room_secrets + cross-check participants regardless of the caller's RLS.
create or replace function public.can_enter_room(
  p_room_id uuid,
  p_access_code text default null
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_is_member boolean;
  v_code text;
begin
  if p_room_id is null then
    return 'denied';
  end if;

  select * into v_room
    from public.rooms
    where id = p_room_id and archived_at is null;
  if v_room is null then
    return 'denied';
  end if;

  -- Must belong to the room's org at all (matches the rooms SELECT policy).
  select exists (
    select 1 from public.team_members
    where team_id = v_room.team_id and user_id = auth.uid()
  ) into v_is_member;
  if not v_is_member then
    return 'denied';
  end if;

  -- Managers (owner / org admin / gating-team lead) always get in, and are
  -- never locked out of a 'code' room that has no PIN configured yet.
  if v_room.created_by = auth.uid()
     or public.is_org_admin_of_room(p_room_id)
     or public.is_lead_of_any_gating_team(p_room_id) then
    return 'allowed';
  end if;

  -- Already an active participant of this room's live session → re-entry /
  -- cross-device rehydrate is always allowed (they were admitted already).
  if exists (
    select 1
    from public.sync_sessions s
    join public.sync_session_participants p on p.session_id = s.id
    where s.room_id = p_room_id
      and s.status = 'active'
      and p.user_id = auth.uid()
      and p.left_at is null
  ) then
    return 'allowed';
  end if;

  -- Policy gate.
  if v_room.entry_policy = 'open' then
    return 'allowed';
  elsif v_room.entry_policy = 'code' then
    select code into v_code from public.room_secrets where room_id = p_room_id;
    if v_code is null then
      -- 'code' room with no PIN set: managers only (handled above) until
      -- one is configured. Fail closed for everyone else.
      return 'denied';
    end if;
    if p_access_code is not null
       and upper(trim(p_access_code)) = upper(trim(v_code)) then
      return 'allowed';
    end if;
    return 'denied';
  end if;

  return 'denied';
end;
$$;

grant execute on function public.can_enter_room(uuid, text) to authenticated;

-- ── 4. management RPCs ─────────────────────────────────────────────
-- Same permission predicate as the other room-mutation RPCs:
--   org admin of room OR lead of a gating team OR room creator.
create or replace function public.set_room_entry_policy(
  p_room_id uuid,
  p_policy text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_policy public.room_entry_policy := p_policy::public.room_entry_policy;
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
    raise exception 'You do not have permission to change this room''s access';
  end if;
  update public.rooms set entry_policy = v_policy where id = p_room_id;
end;
$$;

grant execute on function public.set_room_entry_policy(uuid, text) to authenticated;

-- Set (or clear, with null/empty) a room's access code. Stored uppercased
-- + trimmed so the verify in can_enter_room is case-insensitive.
create or replace function public.set_room_access_code(
  p_room_id uuid,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_clean text;
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
    raise exception 'You do not have permission to change this room''s code';
  end if;

  v_clean := upper(trim(coalesce(p_code, '')));
  if v_clean = '' then
    delete from public.room_secrets where room_id = p_room_id;
    return;
  end if;
  if length(v_clean) < 4 or length(v_clean) > 16 then
    raise exception 'Code must be 4-16 characters';
  end if;

  insert into public.room_secrets (room_id, code, set_by, set_at)
  values (p_room_id, v_clean, auth.uid(), pg_catalog.now())
  on conflict (room_id) do update
    set code = excluded.code, set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

grant execute on function public.set_room_access_code(uuid, text) to authenticated;

-- ── 5. enforce on entry: start_or_join_room_session ────────────────
-- Drop the old signature (param list changes — p_access_code appended).
drop function if exists public.start_or_join_room_session(
  uuid, text, uuid, text, text, jsonb, boolean);

create or replace function public.start_or_join_room_session(
  p_room_id uuid,
  p_join_code text,
  p_team_id uuid default null,
  p_visibility text default 'team',
  p_control_mode text default 'leader',
  p_durations jsonb default null,
  p_auto_transition boolean default null,
  p_access_code text default null
)
returns public.sync_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_live int;
begin
  if p_room_id is null then
    raise exception 'room_id is required';
  end if;

  -- Enforce room privacy BEFORE any insert/lock side effects. Fails closed.
  if public.can_enter_room(p_room_id, p_access_code) <> 'allowed' then
    raise exception 'room_entry_denied' using errcode = '42501';
  end if;

  -- Serialize all start/join attempts for this room (see original notes in
  -- 20260620120000): the per-room advisory lock removes the start-vs-start
  -- race on sync_sessions_one_active_per_room.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_room_id::text, 0));

  select * into v_session
    from public.sync_sessions
    where room_id = p_room_id and status = 'active'
    limit 1;

  if found then
    select count(*) into v_live
      from public.sync_session_participants
      where session_id = v_session.id
        and left_at is null
        and last_seen_at > pg_catalog.now() - interval '120 seconds';
    if v_live > 0 then
      return v_session; -- live session — caller joins it
    end if;
    -- Ghost (everyone abandoned it): tear down so we reset to zero.
    delete from public.sync_sessions where id = v_session.id;
  end if;

  insert into public.sync_sessions
    (leader_id, controller_id, join_code, team_id, room_id, visibility, control_mode, durations, auto_transition)
  values
    (auth.uid(), auth.uid(), p_join_code, p_team_id, p_room_id,
     coalesce(p_visibility, 'team'),
     coalesce(p_control_mode, 'leader'),
     coalesce(p_durations, '{"work":1500,"shortBreak":300,"longBreak":900}'::jsonb),
     coalesce(p_auto_transition, true))
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.start_or_join_room_session(
  uuid, text, uuid, text, text, jsonb, boolean, text) to authenticated;

-- ── 6. enforce on entry: join_sync_session ─────────────────────────
-- The "join by code" path (occupied room, or createSyncSession's follow-up
-- self-join) does NOT go through start_or_join, so it must re-check. A team
-- member can read a session's join_code via RLS, so without this check they
-- could call join_sync_session directly and bypass the room PIN.
drop function if exists public.join_sync_session(text, text);

create or replace function public.join_sync_session(
  p_join_code text,
  p_display_name text default '',
  p_access_code text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_participant public.sync_session_participants;
  v_avatar text;
  v_clean_name text;
  v_count int;
begin
  v_clean_name := coalesce(substring(trim(coalesce(p_display_name, '')) from 1 for 60), '');
  if v_clean_name = '' then
    raise exception 'display_name_required';
  end if;

  select * into v_session
    from public.sync_sessions
    where join_code = upper(p_join_code)
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  -- Room privacy gate (no-op for ad-hoc / non-room sessions).
  if v_session.room_id is not null
     and public.can_enter_room(v_session.room_id, p_access_code) <> 'allowed' then
    return json_build_object('error', 'room_entry_denied');
  end if;

  select count(*) into v_count
    from public.sync_session_participants
    where session_id = v_session.id and left_at is null;

  if v_count >= v_session.max_participants then
    return json_build_object('error', 'Session is full');
  end if;

  select avatar_url into v_avatar
    from public.user_settings
    where user_id = auth.uid();

  insert into public.sync_session_participants
    (session_id, user_id, display_name, avatar_url)
    values (v_session.id, auth.uid(), v_clean_name, v_avatar)
    on conflict (session_id, user_id)
    do update set
      left_at = null,
      joined_at = now(),
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url
    returning * into v_participant;

  return json_build_object(
    'session', row_to_json(v_session),
    'participant', row_to_json(v_participant)
  );
end;
$$;

grant execute on function public.join_sync_session(text, text, text) to authenticated;

-- ── 7. retire the invite_code lifecycle ────────────────────────────
-- Keep the meeting auto-expiry; drop the private-room code-minting branch.
create or replace function public.sync_session_room_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if new.room_id is null then return new; end if;
  select * into v_room from public.rooms where id = new.room_id;
  if v_room is null then return new; end if;

  -- Auto-expire for meeting rooms.
  if v_room.kind = 'meeting'
     and v_room.max_duration_minutes is not null
     and new.expires_at is null then
    new.expires_at := pg_catalog.now()
                    + (v_room.max_duration_minutes * interval '1 minute');
  end if;

  -- (Private-room invite-code minting removed — privacy is enforced via
  --  rooms.entry_policy + can_enter_room. See this migration.)
  return new;
end;
$$;

-- The "unlock on session delete" trigger is no longer meaningful — the PIN
-- is persistent, not session-scoped.
drop trigger if exists tr_sync_session_unlock_room on public.sync_sessions;
drop function if exists public.unlock_private_room_on_session_delete();

-- ── 8. create_room_v2: private rooms get an enforced code + PIN ────
-- Same signature as 20260615000000 (no param change) so just replace the
-- body: stamp entry_policy from kind and seed a shareable PIN for private
-- rooms so a brand-new private room is immediately locked-but-usable.
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

  -- Auto-placement when caller doesn't specify a position.
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
     layout_x, layout_y, layout_w, layout_h, max_duration_minutes, entry_policy)
  values
    (p_team_id, v_clean_name, v_kind, null, auth.uid(),
     coalesce(p_color, '#14b8a6'),
     v_x, v_y, v_w, v_h,
     case when v_kind = 'meeting' then p_max_duration_minutes else null end,
     case when v_kind = 'private' then 'code'::public.room_entry_policy
          else 'open'::public.room_entry_policy end)
  returning id into v_room_id;

  -- Seed a shareable PIN so a new private room is locked but immediately
  -- usable — the creator can view/share it from Room settings.
  if v_kind = 'private' then
    insert into public.room_secrets (room_id, code, set_by)
    values (
      v_room_id,
      upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6)),
      auth.uid()
    )
    on conflict (room_id) do nothing;
  end if;

  if array_length(v_gating, 1) is not null then
    insert into public.room_teams (room_id, org_team_id)
    select v_room_id, t.id from unnest(v_gating) as t(id);
  end if;

  return v_room_id;
end;
$$;

grant execute on function public.create_room_v2(
  uuid, text, text, uuid[], int, int, int, int, text, int) to authenticated;

-- ── 9. migrate existing data ───────────────────────────────────────
-- Existing private rooms were *intended* to be private but never enforced.
-- Convert them to an enforced 'code' policy with a fresh, persistent,
-- shareable PIN (managers can view it in Room settings and share it).
update public.rooms
  set entry_policy = 'code'
  where kind = 'private' and archived_at is null and entry_policy <> 'code';

insert into public.room_secrets (room_id, code, set_by, set_at)
select r.id,
       upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6)),
       r.created_by,
       pg_catalog.now()
from public.rooms r
where r.kind = 'private' and r.archived_at is null
on conflict (room_id) do nothing;

-- Stop leaking the retired per-room code: it sat on the rooms row, which
-- the SELECT policy returns whole. Null it everywhere — the mechanism is
-- gone and the constraint allows a null code on any kind.
update public.rooms set invite_code = null where invite_code is not null;

notify pgrst, 'reload schema';
