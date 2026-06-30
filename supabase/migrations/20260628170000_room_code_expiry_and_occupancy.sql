-- Extends the in-flight room-privacy feature (20260627120000) with two rules:
--
--   1. Access codes EXPIRE — a fixed 24h TTL from when the code is set. After
--      that, can_enter_room rejects the code (so a shared link/PIN handed to an
--      outsider stops working). Managers + already-in participants are unaffected.
--
--   2. Private ('code') rooms are gated by OCCUPANCY: an EMPTY private room is
--      free to claim (any org member can enter), but once someone is inside,
--      joining requires the (non-expired) code. Mirrors the dynamic lock the UI
--      shows — unlocked while empty, locked once in use.
--
-- This CREATE OR REPLACEs functions defined in 20260627120000; it must run after
-- it (later timestamp). It only references already-deployed helpers + tables.

-- 24h TTL on every code. The column default covers codes seeded directly (e.g.
-- the auto-PIN on private-room creation); set_room_access_code refreshes it on
-- each edit. Null = never expires (treated as always-valid).
alter table public.room_secrets
  add column if not exists expires_at timestamptz default (now() + interval '24 hours');

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
  v_expires timestamptz;
  v_occupied boolean;
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

  -- Managers (owner / org admin / gating-team lead) always get in.
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
    -- Occupancy gate: an EMPTY private room is free to claim; the code is only
    -- required once someone is inside ("unlocked when empty, locked in use").
    select exists (
      select 1
      from public.sync_sessions s
      join public.sync_session_participants p on p.session_id = s.id
      where s.room_id = p_room_id
        and s.status = 'active'
        and p.left_at is null
    ) into v_occupied;
    if not v_occupied then
      return 'allowed';
    end if;

    select code, expires_at into v_code, v_expires
      from public.room_secrets where room_id = p_room_id;
    if v_code is null then
      -- Occupied, no PIN configured → managers only (handled above).
      return 'denied';
    end if;
    if v_expires is not null and v_expires <= now() then
      return 'denied'; -- code expired
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

-- Refresh the 24h expiry whenever the code is (re)set, so regenerating a code
-- extends its life. (Same permission predicate as the original.)
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

  insert into public.room_secrets (room_id, code, set_by, set_at, expires_at)
  values (p_room_id, v_clean, auth.uid(), pg_catalog.now(),
          pg_catalog.now() + interval '24 hours')
  on conflict (room_id) do update
    set code = excluded.code, set_by = excluded.set_by,
        set_at = excluded.set_at, expires_at = excluded.expires_at;
end;
$$;

grant execute on function public.set_room_access_code(uuid, text) to authenticated;

notify pgrst, 'reload schema';
