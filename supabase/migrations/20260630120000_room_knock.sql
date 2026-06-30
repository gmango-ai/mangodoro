-- Knock-to-enter for rooms you can't walk into.
--
-- Two lock kinds end at the same gate: (a) an occupied CODE room (empty → anyone
-- walks in; occupied → a non-manager without the PIN is held out) and (b) a
-- DEPARTMENT-gated room the viewer isn't a member of (a client-side visibility
-- gate). Until now both were dead ends. Knock lets the held-out user *ask* the
-- people who can admit them (occupants + the room's managers) to let them in:
--
--   request_room_entry(room)  → inserts a pending row + pings every live
--                               occupant through the notification layer.
--   decide_room_entry(req, ok)→ any live occupant approves/denies.
--   can_enter_room            → a fresh approved grant (<5 min) admits them,
--                               regardless of the code.
--
-- Gated per-room by rooms.knock_enabled (owner can switch a room to true DND).
-- "Any occupant approves" — no owner/leader requirement. In-app + desktop reach
-- comes for free: a brand-new notification type ('knock') falls through
-- notif_type_default_channels' else branch to array['inapp','desktop'].
--
-- Mirrors existing patterns: the emit-to-occupants loop is tg_room_joined
-- (20260623190000); the occupancy predicate + manager checks are lifted from
-- can_enter_room (20260628170000). CREATE OR REPLACE of can_enter_room keeps its
-- 'allowed'|'denied' contract, so neither join RPC needs editing.
--
-- Fresh timestamp (latest applied is 20260628190000); shared DB across branches.

-- ── 1. Per-room toggle ───────────────────────────────────────
alter table public.rooms
  add column if not exists knock_enabled boolean not null default true;

-- Manager-checked setter (mirrors set_room_pin_policy): only the room's
-- creator, an org admin of its team, or a lead of a gating team may toggle it.
create or replace function public.set_room_knock_enabled(
  p_room_id uuid,
  p_enabled boolean
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
    raise exception 'You do not have permission to change this room''s knock setting';
  end if;
  update public.rooms set knock_enabled = coalesce(p_enabled, true) where id = p_room_id;
end;
$$;

grant execute on function public.set_room_knock_enabled(uuid, boolean) to authenticated;

-- ── 2. Knock requests (the waiting room) ─────────────────────
create table if not exists public.room_knock_requests (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'denied')),
  decided_by   uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);

-- One live knock per person per room (re-knock is idempotent / race-proof);
-- decided rows aren't covered, so history accumulates and a new cycle is fine.
create unique index if not exists room_knock_requests_one_pending
  on public.room_knock_requests (room_id, user_id)
  where status = 'pending';

-- Lookup index for the occupant banner subscription + can_enter_room grant.
create index if not exists room_knock_requests_room_status
  on public.room_knock_requests (room_id, status);

alter table public.room_knock_requests enable row level security;

-- The knocker reads their own rows (so the waiting gate sees approve/deny flip).
drop policy if exists "knocker reads own requests" on public.room_knock_requests;
create policy "knocker reads own requests"
  on public.room_knock_requests for select
  using (user_id = auth.uid());

-- Current live occupants of the room read its requests (drives the in-room
-- "<name> is knocking" banner). Same occupancy predicate as can_enter_room.
drop policy if exists "occupants read room requests" on public.room_knock_requests;
create policy "occupants read room requests"
  on public.room_knock_requests for select
  using (
    exists (
      select 1
      from public.sync_sessions s
      join public.sync_session_participants p on p.session_id = s.id
      where s.room_id = room_knock_requests.room_id
        and s.status = 'active'
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  );

-- No INSERT/UPDATE/DELETE policies: all writes go through the security-definer
-- RPCs below, which bypass RLS. Clients can only read.

-- Realtime so both sides get postgres_changes (same transport as chat).
do $$
begin
  alter publication supabase_realtime add table public.room_knock_requests;
exception
  when duplicate_object then null;
end $$;

-- ── 3. request_room_entry — knock + notify occupants/managers ─
-- Works for BOTH lock kinds: an occupied code room, and a department-gated
-- room the caller isn't a member of (dept gating is a client-side visibility
-- gate today, but a knock is still the social ask). Recipients = live
-- occupants + the room's managers (owner / org admins / gating-team leads), so
-- an empty department room can still be answered.
create or replace function public.request_room_entry(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room         public.rooms;
  v_name         text;
  v_payload      jsonb;
  v_req_id       uuid;
  v_dept_gated   boolean;
  v_dept_blocked boolean;
  v_occupied     boolean;
  v_code_blocked boolean;
  r              record;
begin
  if p_room_id is null then
    raise exception 'Room not found';
  end if;

  select * into v_room
    from public.rooms
    where id = p_room_id and archived_at is null;
  if v_room is null then
    raise exception 'Room not found';
  end if;

  -- Must belong to the room's org (matches the rooms SELECT policy / gate).
  if not exists (
    select 1 from public.team_members
    where team_id = v_room.team_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this room''s organization';
  end if;

  if v_room.knock_enabled is not true then
    raise exception 'This room does not accept knocks';
  end if;

  -- Managers can already walk in, so they never knock.
  if v_room.created_by = auth.uid()
     or public.is_org_admin_of_room(p_room_id)
     or public.is_lead_of_any_gating_team(p_room_id) then
    raise exception 'You can already enter this room';
  end if;

  -- Blocked by a department gate (room is gated and caller is in none of the
  -- gating teams)…
  v_dept_gated := exists (select 1 from public.room_teams rt where rt.room_id = p_room_id);
  v_dept_blocked := v_dept_gated and not exists (
    select 1 from public.room_teams rt
    join public.org_team_members otm on otm.org_team_id = rt.org_team_id
    where rt.room_id = p_room_id and otm.user_id = auth.uid()
  );

  -- …or by the code lock (a code room someone is already inside).
  select exists (
    select 1 from public.sync_sessions s
    join public.sync_session_participants p on p.session_id = s.id
    where s.room_id = p_room_id and s.status = 'active' and p.left_at is null
  ) into v_occupied;
  v_code_blocked := v_room.entry_policy = 'code' and v_occupied;

  if not (v_dept_blocked or v_code_blocked) then
    raise exception 'This room does not require a knock';
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = auth.uid();
  v_name := coalesce(v_name, 'Someone');

  -- One live pending row per (room, user); a repeat knock refreshes it.
  insert into public.room_knock_requests (room_id, user_id, display_name, status)
  values (p_room_id, auth.uid(), v_name, 'pending')
  on conflict (room_id, user_id) where status = 'pending'
    do update set created_at = pg_catalog.now(), display_name = excluded.display_name
  returning id into v_req_id;

  v_payload := jsonb_build_object(
    'room_id', p_room_id,
    'request_id', v_req_id,
    'route', '/office/r/' || p_room_id::text
  );

  -- Ping everyone who can let them in: live occupants + managers (owner, org
  -- admins, gating-team leads). In-app + desktop. emit_notification dedupes.
  for r in
    select distinct uid from (
      select p.user_id as uid
        from public.sync_session_participants p
        join public.sync_sessions s on s.id = p.session_id
       where s.room_id = p_room_id and s.status = 'active' and p.left_at is null
      union
      select v_room.created_by
      union
      select tm.user_id
        from public.team_members tm
       where tm.team_id = v_room.team_id and tm.role = 'admin'
      union
      select otm.user_id
        from public.org_team_members otm
        join public.room_teams rt on rt.org_team_id = otm.org_team_id
       where rt.room_id = p_room_id and otm.role = 'lead'
    ) recips
    where uid is not null and uid <> auth.uid()
  loop
    perform public.emit_notification(
      r.uid, 'knock', v_name || ' wants to join ' || v_room.name, null, v_payload,
      auth.uid(), v_room.team_id, 'room', p_room_id,
      'knock:' || p_room_id::text || ':' || auth.uid()::text || ':' || r.uid::text, 2
    );
  end loop;

  return v_req_id;
end;
$$;

grant execute on function public.request_room_entry(uuid) to authenticated;

-- ── 4. decide_room_entry — an occupant OR a manager answers ──
create or replace function public.decide_room_entry(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.room_knock_requests;
begin
  select * into v_req
    from public.room_knock_requests
    where id = p_request_id;
  if v_req is null then
    raise exception 'Knock request not found';
  end if;

  -- A current live occupant OR a manager (owner / org admin / gating-team
  -- lead) may decide. Managers cover an empty department room with nobody in.
  if not (
    public.is_org_admin_of_room(v_req.room_id)
    or public.is_lead_of_any_gating_team(v_req.room_id)
    or exists (select 1 from public.rooms where id = v_req.room_id and created_by = auth.uid())
    or exists (
      select 1
      from public.sync_sessions s
      join public.sync_session_participants p on p.session_id = s.id
      where s.room_id = v_req.room_id
        and s.status = 'active'
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  ) then
    raise exception 'You are not allowed to answer this knock';
  end if;

  -- First decision wins; ignore re-decides on an already-resolved row.
  if v_req.status <> 'pending' then
    return;
  end if;

  update public.room_knock_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(),
         decided_at = pg_catalog.now()
   where id = p_request_id;
end;
$$;

grant execute on function public.decide_room_entry(uuid, boolean) to authenticated;

-- ── 5. can_enter_room — honor a fresh approved grant ─────────
-- CREATE OR REPLACE of the 20260628170000 definition, adding one branch in the
-- code + occupied path: a knock approved in the last 5 minutes admits the
-- caller regardless of the code. Once in, they become an active participant and
-- the participant re-entry branch covers them. Contract unchanged.
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

    -- A knock approved within the last 5 minutes admits them, code or no code.
    if exists (
      select 1 from public.room_knock_requests k
      where k.room_id = p_room_id
        and k.user_id = auth.uid()
        and k.status = 'approved'
        and k.decided_at > now() - interval '5 minutes'
    ) then
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

notify pgrst, 'reload schema';
