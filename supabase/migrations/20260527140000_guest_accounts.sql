-- Phase 4: Guest accounts (Supabase anonymous auth) + required display name.
--
-- Adds user_settings.is_guest, tightens join_team_by_code to reject guests,
-- and updates join_sync_session to require a non-empty display name.

-- ── user_settings.is_guest ─────────────────────────────────────
alter table public.user_settings
  add column if not exists is_guest boolean not null default false;

-- Helper: detect anonymous auth users via JWT claim.
-- supabase-js issues `is_anonymous = true` in the JWT for guests.
create or replace function public.is_anonymous_auth()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif((auth.jwt() ->> 'is_anonymous'), '')::boolean,
    false
  );
$$;

-- ── Harden join_team_by_code: block guests ─────────────────────
create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_existing uuid;
begin
  if public.is_anonymous_auth() then
    raise exception 'Guests cannot join teams';
  end if;

  select id into v_team_id from public.teams where invite_code = lower(code);
  if v_team_id is null then
    raise exception 'Invalid invite code';
  end if;

  select id into v_existing
  from public.team_members
  where team_id = v_team_id and user_id = auth.uid();
  if v_existing is not null then
    return v_team_id;
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, auth.uid(), 'member');

  return v_team_id;
end;
$$;

-- ── join_sync_session: require non-empty display name ──────────
create or replace function public.join_sync_session(
  p_join_code text,
  p_display_name text default ''
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_participant public.sync_session_participants;
  v_avatar text;
  v_clean_name text;
  v_count int;
begin
  v_clean_name := coalesce(substring(trim(coalesce(p_display_name, '')) from 1 for 60), '');
  if v_clean_name = '' then
    raise exception 'display_name_required';
  end if;

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

  select avatar_url into v_avatar
    from public.user_settings
    where user_id = auth.uid();

  insert into public.sync_session_participants
    (session_id, user_id, display_name, avatar_url)
    values (v_session.id, auth.uid(), v_clean_name, v_avatar)
    on conflict (session_id, user_id)
    do update set
      left_at = null,
      joined_at = now(),
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url
    returning * into v_participant;

  return json_build_object(
    'session', row_to_json(v_session),
    'participant', row_to_json(v_participant)
  );
end;
$$;

-- ── Preview RPC: minimal info for /pomodoro/join/:code landing ──
-- Returns leader display name, mode, and participant count without
-- exposing internal IDs. Safe to call unauthenticated.
create or replace function public.get_sync_session_preview(p_join_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_leader_name text;
  v_count int;
begin
  select * into v_session
    from public.sync_sessions
    where join_code = upper(p_join_code)
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  select coalesce(name, 'Pomodoro session') into v_leader_name
    from public.user_settings
    where user_id = v_session.leader_id;

  select count(*) into v_count
    from public.sync_session_participants
    where session_id = v_session.id and left_at is null;

  return json_build_object(
    'leader_name', v_leader_name,
    'mode', v_session.mode,
    'participants', v_count,
    'max_participants', v_session.max_participants,
    'visibility', v_session.visibility,
    'control_mode', v_session.control_mode
  );
end;
$$;

grant execute on function public.get_sync_session_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';
