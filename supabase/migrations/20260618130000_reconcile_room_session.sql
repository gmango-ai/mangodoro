-- Read-time reconcile for room sessions (room lifecycle 2/6).
--
-- A room allows only one active session (unique index
-- sync_sessions_one_active_per_room). When everyone abandons a room by
-- closing tabs, the session row lingers as a ghost: status still
-- 'active', participants still left_at = null, meeting timer frozen
-- mid-count. The next person to "start" a session in that room would
-- collide with the unique index AND inherit the stale timer.
--
-- reconcile_room_session tears down a room's session IFF it has no live
-- participant (none seen within the grace window). Called lazily right
-- before we create a fresh session (see createSyncSession), this is what
-- delivers the "reset to zero" behavior when someone re-enters an
-- abandoned room — without waiting for the periodic sweep (increment 4,
-- which is the safety net for rooms nobody re-enters).
--
-- Deleting the row (vs. soft-ending) lets the existing BEFORE DELETE
-- trigger unlock a linked private room and the cascade clear participants
-- in one atomic step — same teardown path as leave_sync_session.
--
-- GRACE WINDOW: 120s. Foreground clients heartbeat every 20s, so a live
-- tab is never stale; this only reaps sessions whose every occupant has
-- been gone/suspended for >2 minutes. Keep in sync with PRESENCE_GRACE_MS
-- in src/lib/syncSession.js.

create or replace function public.reconcile_room_session(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_live int;
begin
  if p_room_id is null then
    return null;
  end if;

  select id into v_session_id
    from public.sync_sessions
    where room_id = p_room_id
      and status = 'active'
    limit 1;

  if v_session_id is null then
    return null;
  end if;

  select count(*) into v_live
    from public.sync_session_participants
    where session_id = v_session_id
      and left_at is null
      and last_seen_at > pg_catalog.now() - interval '120 seconds';

  -- Live occupant present → leave it alone; the caller should join, not
  -- start. (The unique index will reject a competing insert anyway.)
  if v_live > 0 then
    return null;
  end if;

  delete from public.sync_sessions where id = v_session_id;
  return v_session_id;
end;
$$;

grant execute on function public.reconcile_room_session(uuid) to authenticated;
