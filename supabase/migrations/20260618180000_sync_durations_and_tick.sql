-- Sync session durations + server-authoritative phase advancement.

alter table public.sync_sessions
  add column if not exists durations jsonb not null default '{"work":1500,"shortBreak":300,"longBreak":900}'::jsonb,
  add column if not exists auto_transition boolean not null default true;

alter table public.user_pomodoro_state
  add column if not exists durations jsonb not null default '{"work":1500,"shortBreak":300,"longBreak":900}'::jsonb,
  add column if not exists auto_transition boolean not null default true;

create or replace function public.sync_tick_if_due(p_session_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_durations jsonb;
  v_work int;
  v_short int;
  v_long int;
  v_next_mode text;
  v_next_sessions int;
begin
  if auth.uid() is null then
    return json_build_object('advanced', false, 'error', 'not authenticated');
  end if;

  if not exists (
    select 1
    from public.sync_session_participants p
    where p.session_id = p_session_id
      and p.user_id = auth.uid()
      and p.left_at is null
  ) then
    return json_build_object('advanced', false, 'error', 'not a participant');
  end if;

  select * into v_session
  from public.sync_sessions
  where id = p_session_id
    and status = 'active'
  for update;

  if not found then
    return json_build_object('advanced', false);
  end if;

  if not v_session.is_running
     or v_session.ends_at is null
     or v_session.ends_at > pg_catalog.now()
  then
    return json_build_object('advanced', false, 'session', row_to_json(v_session));
  end if;

  v_durations := coalesce(
    v_session.durations,
    '{"work":1500,"shortBreak":300,"longBreak":900}'::jsonb
  );
  v_work := coalesce((v_durations->>'work')::int, 1500);
  v_short := coalesce((v_durations->>'shortBreak')::int, 300);
  v_long := coalesce((v_durations->>'longBreak')::int, 900);

  if v_session.pending_mode is not null then
    update public.sync_sessions
      set mode = v_session.pending_mode,
          pending_mode = null,
          remaining_seconds = case v_session.pending_mode
            when 'work' then v_work
            when 'shortBreak' then v_short
            when 'longBreak' then v_long
            else v_short
          end,
          is_running = true
    where id = p_session_id
    returning * into v_session;

    return json_build_object('advanced', true, 'session', row_to_json(v_session));
  end if;

  if v_session.mode = 'work' then
    v_next_sessions := v_session.sessions + 1;
    v_next_mode := case
      when v_next_sessions > 0 and v_next_sessions % 4 = 0 then 'longBreak'
      else 'shortBreak'
    end;

    if coalesce(v_session.auto_transition, true) then
      update public.sync_sessions
        set sessions = v_next_sessions,
            pending_mode = v_next_mode,
            remaining_seconds = 5,
            is_running = true
      where id = p_session_id
      returning * into v_session;
    else
      update public.sync_sessions
        set sessions = v_next_sessions,
            mode = v_next_mode,
            pending_mode = null,
            remaining_seconds = case v_next_mode
              when 'longBreak' then v_long
              else v_short
            end,
            is_running = true
      where id = p_session_id
      returning * into v_session;
    end if;

    return json_build_object('advanced', true, 'session', row_to_json(v_session));
  end if;

  v_next_sessions := case
    when v_session.mode = 'longBreak' then 0
    else v_session.sessions
  end;

  update public.sync_sessions
    set mode = 'work',
        sessions = v_next_sessions,
        pending_mode = null,
        remaining_seconds = v_work,
        is_running = false
  where id = p_session_id
  returning * into v_session;

  return json_build_object('advanced', true, 'session', row_to_json(v_session));
end;
$$;

grant execute on function public.sync_tick_if_due(uuid) to authenticated;
