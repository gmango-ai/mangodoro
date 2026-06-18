-- Leave: hand off the timer CONTROLLER too, not just the leader.
--
-- connection_aware_leave (room lifecycle 3/6) reassigned only leader_id
-- when the host left, leaving controller_id pinned to the departed user.
-- Result: the new leader inherited the title but not timer control —
-- "leadership didn't transfer fully" — and the orphaned controller_id
-- left the room's timer stuck behind an absent controller until someone
-- manually took control.
--
-- Restore the controller hand-off that the pre-lifecycle version had
-- (and that claim_session_lead / reassign_stale_leaders already do):
-- whenever the departing user is the leader and/or the controller, move
-- that role to the next-joined LIVE participant. A role the caller did
-- NOT hold is left untouched (e.g. don't yank control from a participant
-- who took it while the leader leaves).
--
-- GRACE WINDOW 120s — keep in sync with the other lifecycle functions and
-- PRESENCE_GRACE_MS in src/lib/syncSession.js.

create or replace function public.leave_sync_session(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_next_live uuid;
  v_next_leader uuid;
  v_live_others int;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then
    -- Already gone — idempotent success.
    return json_build_object('ok', true, 'ended', true);
  end if;

  -- Count LIVE participants other than the caller (fresh heartbeat).
  select count(*) into v_live_others
  from public.sync_session_participants
  where session_id = p_session_id
    and user_id <> auth.uid()
    and left_at is null
    and last_seen_at > pg_catalog.now() - interval '120 seconds';

  if v_live_others = 0 then
    -- Nobody live left behind (any remaining rows are ghosts). Delete the
    -- session row; the BEFORE DELETE trigger unlocks the private room (if
    -- any) and the ON DELETE CASCADE clears participant rows.
    delete from public.sync_sessions where id = p_session_id;
    return json_build_object('ok', true, 'ended', true);
  end if;

  -- Live folks remain — mark caller as left.
  update public.sync_session_participants
    set left_at = pg_catalog.now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  -- Oldest-joined LIVE participant other than the caller. Guaranteed
  -- non-null here (v_live_others >= 1). Inherits any role the caller held.
  select user_id into v_next_live
  from public.sync_session_participants
  where session_id = p_session_id
    and user_id <> auth.uid()
    and left_at is null
    and last_seen_at > pg_catalog.now() - interval '120 seconds'
  order by joined_at asc
  limit 1;

  -- Hand off whichever role(s) the caller held to the next live member.
  if v_session.leader_id = auth.uid() or v_session.controller_id = auth.uid() then
    -- Bypass the leader-only metadata guard (tr_sync_session_guard_update):
    -- we're assigning leader_id / controller_id to someone OTHER than the
    -- caller, which the guard would otherwise reject. Same pattern as
    -- transfer_sync_leader / claim_session_lead.
    perform set_config('sync.internal_update', '1', true);
    update public.sync_sessions
      set leader_id = case when v_session.leader_id = auth.uid()
                           then v_next_live else leader_id end,
          controller_id = case when v_session.controller_id = auth.uid()
                               then v_next_live else controller_id end
      where id = p_session_id;
    if v_session.leader_id = auth.uid() then
      v_next_leader := v_next_live;
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'new_leader_id', v_next_leader,
    'ended', false
  );
end;
$$;

grant execute on function public.leave_sync_session(uuid) to authenticated;

notify pgrst, 'reload schema';
