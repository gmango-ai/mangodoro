-- Connection-aware leave (room lifecycle 3/6).
--
-- Membership is per-user, but "is the room now empty?" must be judged by
-- who is *live* (fresh heartbeat), not merely who has left_at = null.
-- Otherwise an explicit leave by the last real person wouldn't tear the
-- room down if a ghost row (closed tab, left_at still null) lingered —
-- the room would look occupied by a phantom.
--
-- This redefines leave_sync_session to:
--   • count only LIVE other participants when deciding to hard-delete,
--     so a room whose only remaining "members" are ghosts is torn down;
--   • promote the next LIVE participant to leader (skipping ghosts).
--
-- Incidental navigation / tab close no longer calls this at all (see
-- OfficeShell): you stay in the session, heartbeating, until you click
-- Leave (this RPC) or your last connection goes stale and the sweeper
-- (4/6) reaps the room. This RPC is now the *explicit* leave path only,
-- and it removes the user across all their tabs/devices of the room.
--
-- GRACE WINDOW 120s — keep in sync with reconcile_room_session and
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

  -- If the caller was the leader, hand off to the next-joined LIVE
  -- participant (a stale ghost shouldn't inherit leadership).
  if v_session.leader_id = auth.uid() then
    select user_id into v_next_leader
    from public.sync_session_participants
    where session_id = p_session_id
      and user_id <> auth.uid()
      and left_at is null
      and last_seen_at > pg_catalog.now() - interval '120 seconds'
    order by joined_at asc
    limit 1;
    if v_next_leader is not null then
      -- Bypass the leader-only metadata guard (tr_sync_session_guard_update):
      -- we're handing leadership to someone OTHER than the caller, which the
      -- guard would otherwise reject. Same pattern as transfer_sync_leader.
      perform set_config('sync.internal_update', '1', true);
      update public.sync_sessions
        set leader_id = v_next_leader
        where id = p_session_id;
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
