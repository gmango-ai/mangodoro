-- Single active room per user, across ALL their instances (tabs / desktop /
-- mobile). Until now a user could be a live participant in multiple rooms'
-- sessions at once (open two tabs → two rooms); nothing enforced exclusivity.
--
-- Enforcement is server-authoritative via a trigger on sync_session_participants:
-- the instant a user (re)joins a room, we leave every OTHER active session they
-- have a live row in, reusing the connection-aware leave semantics (leader +
-- controller hand-off; delete the room if no live others remain). The existing
-- realtime subscription on sync_session_participants then flips those other
-- instances to left_at → they clear locally and their call ends.
--
-- A trigger (not a change to join_sync_session) so every join path is covered,
-- and it's impossible to bypass from the client. Device/kiosk accounts are
-- already blocked from joining any session (block_device_session_join), so they
-- never reach this and stay pinned to their one room.
--
-- GRACE WINDOW 120s — keep in sync with the other lifecycle functions and
-- PRESENCE_GRACE_MS in src/lib/syncSession.js.

-- Leave every active session for p_user_id EXCEPT p_keep_session_id, applying
-- the same per-session semantics as leave_sync_session (20260618190000).
create or replace function public.leave_other_room_sessions(
  p_user_id uuid,
  p_keep_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_next_live uuid;
  v_live_others int;
begin
  for r in
    select ss.id, ss.leader_id, ss.controller_id
    from public.sync_session_participants ssp
    join public.sync_sessions ss on ss.id = ssp.session_id
    where ssp.user_id = p_user_id
      and ssp.left_at is null
      and ssp.session_id <> p_keep_session_id
  loop
    -- Live participants OTHER than this user in that room.
    select count(*) into v_live_others
    from public.sync_session_participants
    where session_id = r.id
      and user_id <> p_user_id
      and left_at is null
      and last_seen_at > pg_catalog.now() - interval '120 seconds';

    if v_live_others = 0 then
      -- No one live left behind → tear the room's session down (the BEFORE
      -- DELETE trigger unlocks a private room; cascade clears participants).
      delete from public.sync_sessions where id = r.id;
    else
      update public.sync_session_participants
        set left_at = pg_catalog.now()
        where session_id = r.id and user_id = p_user_id and left_at is null;

      -- Hand off whichever role(s) the leaver held to the next live member.
      select user_id into v_next_live
      from public.sync_session_participants
      where session_id = r.id
        and user_id <> p_user_id
        and left_at is null
        and last_seen_at > pg_catalog.now() - interval '120 seconds'
      order by joined_at asc
      limit 1;

      if r.leader_id = p_user_id or r.controller_id = p_user_id then
        -- Bypass the leader-only metadata guard (same pattern as
        -- leave_sync_session / transfer_sync_leader).
        perform pg_catalog.set_config('sync.internal_update', '1', true);
        update public.sync_sessions
          set leader_id = case when r.leader_id = p_user_id then v_next_live else leader_id end,
              controller_id = case when r.controller_id = p_user_id then v_next_live else controller_id end
          where id = r.id;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function public.leave_other_room_sessions(uuid, uuid) to authenticated;

-- Trigger: on a genuine (re)join, enforce single-room for that user.
create or replace function public.enforce_single_room_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only act on a live (re)join. Skip:
  --   • leaves / this trigger's own left_at writes (NEW.left_at not null),
  --   • heartbeats (UPDATE that keeps left_at null AND joined_at unchanged).
  if NEW.left_at is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.joined_at is not distinct from OLD.joined_at then
    return NEW;
  end if;

  -- Serialize a single user's concurrent joins (two instances joining two
  -- rooms at the same moment) so they resolve to ONE room — last join wins —
  -- instead of each leaving the other. Transaction-scoped, released on commit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(NEW.user_id::text)::bigint);

  perform public.leave_other_room_sessions(NEW.user_id, NEW.session_id);
  return NEW;
end;
$$;

drop trigger if exists tr_enforce_single_room on public.sync_session_participants;
create trigger tr_enforce_single_room
  after insert or update on public.sync_session_participants
  for each row
  execute function public.enforce_single_room_session();

notify pgrst, 'reload schema';
