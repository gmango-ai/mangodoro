-- Atomic "start or join" for a room's sync session.
--
-- A room allows only one active session (unique index
-- sync_sessions_one_active_per_room). The old client flow —
-- reconcile_room_session() then a client-side INSERT — races: two people
-- hitting "Start" in the same room at once (or a double-fire) both pass
-- reconcile, both INSERT, and the loser hits
--   duplicate key value violates unique constraint "sync_sessions_one_active_per_room"
--
-- This RPC removes the race by serializing per-room with a transaction
-- advisory lock, then doing find-or-create in one transaction:
--   • take a per-room advisory lock (so concurrent calls queue)
--   • if a live active session exists → return it (caller will join it)
--   • if only a ghost exists (no participant seen within the grace
--     window) → tear it down (reset-to-zero) and create fresh
--   • else create fresh
-- The caller still calls join_sync_session() afterwards with the returned
-- row's join_code (idempotent) to add itself as a participant.
--
-- GRACE WINDOW 120s — keep in sync with reconcile_room_session and
-- PRESENCE_GRACE_MS in src/lib/syncSession.js.

create or replace function public.start_or_join_room_session(
  p_room_id uuid,
  p_join_code text,
  p_team_id uuid default null,
  p_visibility text default 'team',
  p_control_mode text default 'leader',
  p_durations jsonb default null,
  p_auto_transition boolean default null
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

  -- Serialize all start/join attempts for this room. Transaction-scoped, so
  -- the lock releases when this function's transaction commits and the next
  -- caller then sees the session we just created instead of colliding.
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
    -- Ghost (everyone abandoned it): tear down so we reset to zero. The
    -- BEFORE DELETE trigger unlocks a linked private room + cascades
    -- participants, same as reconcile_room_session / leave.
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

grant execute on function public.start_or_join_room_session(uuid, text, uuid, text, text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
