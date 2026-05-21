-- Atomic leave for sync sessions.
-- If the leaver is the current leader, promote the next-oldest active
-- participant. If there's no one else, end the session.
-- Marks the caller as left in all cases.

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
begin
  select * into v_session
    from public.sync_sessions
    where id = p_session_id;

  if not found then
    return json_build_object('error', 'Session not found');
  end if;

  if v_session.status = 'ended' then
    -- Idempotent: mark left and bail out.
    update public.sync_session_participants
      set left_at = coalesce(left_at, now())
      where session_id = p_session_id
        and user_id = auth.uid();
    return json_build_object('ok', true, 'ended', true);
  end if;

  -- If caller is leader, promote or end.
  if v_session.leader_id = auth.uid() then
    select user_id into v_next_leader
      from public.sync_session_participants
      where session_id = p_session_id
        and user_id <> auth.uid()
        and left_at is null
      order by joined_at asc
      limit 1;

    if v_next_leader is not null then
      update public.sync_sessions
        set leader_id = v_next_leader
        where id = p_session_id;
    else
      update public.sync_sessions
        set status = 'ended',
            ended_at = now(),
            is_running = false
        where id = p_session_id;
    end if;
  end if;

  update public.sync_session_participants
    set left_at = now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  return json_build_object(
    'ok', true,
    'new_leader_id', v_next_leader,
    'ended', v_next_leader is null and v_session.leader_id = auth.uid()
  );
end;
$$;
