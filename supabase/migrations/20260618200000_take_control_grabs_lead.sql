-- "Take the lead" grabs BOTH roles: timer controller AND room leader.
--
-- take_sync_control previously set only controller_id, so a participant
-- who took the timer left leader_id (room admin: end, kick, visibility,
-- retro) with the previous host. That produced a confusing split — the
-- "LEADER" badge and the timer-controls badge pointing at different
-- people, with no single person actually in charge.
--
-- Product intent: taking over makes you the session lead, full stop —
-- you control the timer AND the room. Any active participant may do this
-- (gate unchanged). The internal_update flag lets us move leader_id past
-- the leader-only metadata guard (same pattern as transfer_sync_leader).

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
    return json_build_object('error', 'You must be an active participant to take the lead');
  end if;

  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
    set controller_id = auth.uid(),
        leader_id     = auth.uid()
    where id = p_session_id
    returning * into v_session;

  return json_build_object('session', row_to_json(v_session));
end;
$$;

grant execute on function public.take_sync_control(uuid) to authenticated;

notify pgrst, 'reload schema';
