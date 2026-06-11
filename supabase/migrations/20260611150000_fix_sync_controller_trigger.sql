-- Fix: security-definer RPCs (take_sync_control, leave, transfer) were blocked
-- by sync_session_guard_participant_update because the trigger runs as the
-- caller. take_sync_control sets controller_id to auth.uid(), which matched
-- the "controller" branch but controller_id is listed as leader-only metadata.
--
-- Use a transaction-local flag so trusted RPCs can update controller_id / leader_id.

create or replace function public.sync_session_guard_participant_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('sync.internal_update', true), '') = '1' then
    return new;
  end if;

  -- Leader has full write access.
  if auth.uid() = new.leader_id then
    return new;
  end if;

  -- Controller may only change timer fields.
  if auth.uid() = new.controller_id then
    if
      new.id               is distinct from old.id               or
      new.join_code        is distinct from old.join_code        or
      new.leader_id        is distinct from old.leader_id        or
      new.controller_id    is distinct from old.controller_id    or
      new.team_id          is distinct from old.team_id          or
      new.status           is distinct from old.status           or
      new.max_participants is distinct from old.max_participants or
      new.created_at       is distinct from old.created_at       or
      new.ended_at         is distinct from old.ended_at         or
      new.visibility       is distinct from old.visibility       or
      new.control_mode     is distinct from old.control_mode
    then
      raise exception 'Only the leader may change session metadata';
    end if;
    return new;
  end if;

  raise exception 'Only the leader or controller may update the session';
end;
$$;

create or replace function public.take_sync_control(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_is_active_participant boolean;
begin
  select * into v_session
    from public.sync_sessions
    where id = p_session_id
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  select exists (
    select 1 from public.sync_session_participants
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null
  ) into v_is_active_participant;

  if not v_is_active_participant then
    return json_build_object('error', 'You must be an active participant to take control');
  end if;

  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
    set controller_id = auth.uid()
    where id = p_session_id
    returning * into v_session;

  return json_build_object('session', row_to_json(v_session));
end;
$$;

create or replace function public.transfer_sync_leader(
  p_session_id uuid,
  p_new_leader_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_is_active_participant boolean;
begin
  select * into v_session
    from public.sync_sessions
    where id = p_session_id
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  if v_session.leader_id <> auth.uid() then
    return json_build_object('error', 'Only the current leader can transfer ownership');
  end if;

  if p_new_leader_id = v_session.leader_id then
    return json_build_object('error', 'That user is already the leader');
  end if;

  select exists (
    select 1 from public.sync_session_participants
    where session_id = p_session_id
      and user_id = p_new_leader_id
      and left_at is null
  ) into v_is_active_participant;

  if not v_is_active_participant then
    return json_build_object('error', 'New leader must be an active participant');
  end if;

  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
    set
      leader_id = p_new_leader_id,
      controller_id = case
        when controller_id = leader_id then p_new_leader_id
        else controller_id
      end
    where id = p_session_id
    returning * into v_session;

  return json_build_object('session', row_to_json(v_session));
end;
$$;

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
  v_next_controller uuid;
begin
  select * into v_session
    from public.sync_sessions
    where id = p_session_id;

  if not found then
    return json_build_object('error', 'Session not found');
  end if;

  if v_session.status = 'ended' then
    update public.sync_session_participants
      set left_at = coalesce(left_at, now())
      where session_id = p_session_id
        and user_id = auth.uid();
    return json_build_object('ok', true, 'ended', true);
  end if;

  perform set_config('sync.internal_update', '1', true);

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
        set
          leader_id = v_next_leader,
          controller_id = case
            when controller_id = auth.uid() then v_next_leader
            else controller_id
          end
        where id = p_session_id;
    else
      update public.sync_sessions
        set status = 'ended',
            ended_at = now(),
            is_running = false
        where id = p_session_id;
    end if;
  elsif v_session.controller_id = auth.uid() then
    select user_id into v_next_controller
      from public.sync_session_participants
      where session_id = p_session_id
        and user_id <> auth.uid()
        and left_at is null
      order by joined_at asc
      limit 1;

    if v_next_controller is not null then
      update public.sync_sessions
        set controller_id = v_next_controller
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

grant execute on function public.take_sync_control(uuid) to authenticated;

notify pgrst, 'reload schema';
