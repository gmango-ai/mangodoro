-- Fix: join_sync_session must be security definer so a non-participant
-- can look up the session by join code (they can't read sync_sessions yet).

create or replace function public.join_sync_session(p_join_code text, p_display_name text default '')
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_participant public.sync_session_participants;
  v_count int;
begin
  select * into v_session
    from public.sync_sessions
    where join_code = upper(p_join_code)
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  select count(*) into v_count
    from public.sync_session_participants
    where session_id = v_session.id and left_at is null;

  if v_count >= v_session.max_participants then
    return json_build_object('error', 'Session is full');
  end if;

  insert into public.sync_session_participants (session_id, user_id, display_name)
    values (v_session.id, auth.uid(), p_display_name)
    on conflict (session_id, user_id)
    do update set left_at = null, joined_at = now(), display_name = excluded.display_name
    returning * into v_participant;

  return json_build_object(
    'session', row_to_json(v_session),
    'participant', row_to_json(v_participant)
  );
end;
$$;
