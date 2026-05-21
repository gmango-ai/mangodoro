-- Transfer leadership of a sync session to another active participant.
-- Only the current leader may call. The new leader must be an active participant.

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

  update public.sync_sessions
    set leader_id = p_new_leader_id
    where id = p_session_id
    returning * into v_session;

  return json_build_object('session', row_to_json(v_session));
end;
$$;
