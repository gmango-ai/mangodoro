-- Allow the leader to remove (kick) a participant from an active sync session.

create or replace function public.kick_sync_participant(
  p_session_id uuid,
  p_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  select * into v_session
    from public.sync_sessions
    where id = p_session_id
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  if v_session.leader_id <> auth.uid() then
    return json_build_object('error', 'Only the current leader can remove members');
  end if;

  if p_user_id = v_session.leader_id then
    return json_build_object('error', 'Transfer leadership before removing yourself');
  end if;

  update public.sync_session_participants
    set left_at = now()
    where session_id = p_session_id
      and user_id = p_user_id
      and left_at is null;

  return json_build_object('ok', true);
end;
$$;
