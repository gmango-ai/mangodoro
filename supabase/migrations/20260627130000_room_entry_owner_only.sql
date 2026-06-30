-- Room privacy: "open until occupied" + owner-only bypass.
--
-- Desired behaviour for a code-gated room:
--   • EMPTY room  → anyone in the org can be the first one in (no code).
--   • OCCUPIED    → once someone is inside, it locks: everyone else needs
--                   the code to join.
--   • The room OWNER (created_by) and people already inside always get in.
--   • Org admins / gating-team leads do NOT auto-bypass the code — a
--     private room stays private from them too (they can still read the
--     code via room_secrets RLS and enter it deliberately). Otherwise, in
--     an org where most people are admins, the lock would do nothing.
--
-- "Occupied" mirrors the rest of the system's liveness window (120s): a
-- ghost (closed tab, stale heartbeat) does NOT count, so a room everyone
-- abandoned reads as empty and reopens — consistent with the ghost
-- teardown in start_or_join_room_session.

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
  v_live int;
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

  -- Owner always gets into their own room.
  if v_room.created_by = auth.uid() then
    return 'allowed';
  end if;

  -- Open rooms never require a code.
  if v_room.entry_policy = 'open' then
    return 'allowed';
  end if;

  -- ── code-gated room ──
  -- Already inside (active participant row) → re-entry / rehydrate allowed.
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

  -- Count OTHER live occupants (left, fresh heartbeat or just-joined within
  -- the 120s grace). joined_at covers a just-/re-joined person whose
  -- last_seen_at hasn't been heartbeat-refreshed yet.
  select count(*) into v_live
    from public.sync_sessions s
    join public.sync_session_participants p on p.session_id = s.id
    where s.room_id = p_room_id
      and s.status = 'active'
      and p.user_id <> auth.uid()
      and p.left_at is null
      and (p.last_seen_at > pg_catalog.now() - interval '120 seconds'
           or p.joined_at  > pg_catalog.now() - interval '120 seconds');

  -- Open until occupied: empty room → first one in, no code.
  if v_live = 0 then
    return 'allowed';
  end if;

  -- Occupied → require the code.
  select code into v_code from public.room_secrets where room_id = p_room_id;
  if v_code is null then
    return 'denied';
  end if;
  if p_access_code is not null
     and upper(trim(p_access_code)) = upper(trim(v_code)) then
    return 'allowed';
  end if;
  return 'denied';
end;
$$;

notify pgrst, 'reload schema';
