-- Meeting timer attached to a sync_session. The leader picks a
-- duration + an optional music track; the timer ticks down on every
-- client driven by server time so everyone sees the same remaining
-- seconds without needing to clock-sync. Music plays locally per
-- client; the row only carries the track identifier.
--
-- This is intentionally separate from the existing pomodoro-style
-- timer state already on sync_sessions (mode/is_running/...). That
-- one drives the pomodoro engine; this one is a generic meeting
-- countdown that can co-exist (e.g. retro time-box during a
-- pomodoro work block).
--
-- State machine, by column combination:
--   IDLE     started_at IS NULL
--   RUNNING  started_at set, paused = false
--             remaining = duration - elapsed_at_pause - (now - started_at)
--   PAUSED   started_at set, paused = true
--             remaining = duration - elapsed_at_pause
--   DONE     remaining ≤ 0 — same row as RUNNING; UI handles the badge
--             until the leader stops the timer.

alter table public.sync_sessions
  add column if not exists meeting_timer_started_at timestamptz,
  add column if not exists meeting_timer_duration_seconds integer,
  add column if not exists meeting_timer_elapsed_at_pause_seconds integer not null default 0,
  add column if not exists meeting_timer_paused boolean not null default false,
  add column if not exists meeting_timer_track text;

-- The metadata-change guard from 20260611150000 already lets the
-- leader update anything not on its controller-allowed whitelist, so
-- these RPCs (which run security definer and assert leader_id =
-- auth.uid()) pass without touching the trigger.

create or replace function public.start_meeting_timer(
  p_session_id uuid,
  p_duration_seconds integer,
  p_track text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    raise exception 'Duration must be positive';
  end if;
  if p_duration_seconds > 24 * 60 * 60 then
    raise exception 'Duration too long';
  end if;

  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can start the timer';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;

  update public.sync_sessions
    set meeting_timer_started_at = pg_catalog.now(),
        meeting_timer_duration_seconds = p_duration_seconds,
        meeting_timer_elapsed_at_pause_seconds = 0,
        meeting_timer_paused = false,
        meeting_timer_track = p_track
    where id = p_session_id;
end;
$$;

grant execute on function public.start_meeting_timer(uuid, integer, text) to authenticated;

create or replace function public.pause_meeting_timer(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_segment_elapsed integer;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can pause the timer';
  end if;
  if v_session.meeting_timer_started_at is null then
    return; -- idle is a no-op
  end if;
  if v_session.meeting_timer_paused then
    return; -- already paused
  end if;

  v_segment_elapsed := greatest(
    0,
    extract(epoch from pg_catalog.now() - v_session.meeting_timer_started_at)::integer
  );

  update public.sync_sessions
    set meeting_timer_paused = true,
        meeting_timer_elapsed_at_pause_seconds =
          coalesce(meeting_timer_elapsed_at_pause_seconds, 0) + v_segment_elapsed
    where id = p_session_id;
end;
$$;

grant execute on function public.pause_meeting_timer(uuid) to authenticated;

create or replace function public.resume_meeting_timer(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can resume the timer';
  end if;
  if v_session.meeting_timer_started_at is null then
    raise exception 'No timer to resume';
  end if;
  if not v_session.meeting_timer_paused then
    return; -- already running
  end if;

  update public.sync_sessions
    set meeting_timer_paused = false,
        meeting_timer_started_at = pg_catalog.now()
    where id = p_session_id;
end;
$$;

grant execute on function public.resume_meeting_timer(uuid) to authenticated;

create or replace function public.stop_meeting_timer(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can stop the timer';
  end if;

  update public.sync_sessions
    set meeting_timer_started_at = null,
        meeting_timer_duration_seconds = null,
        meeting_timer_elapsed_at_pause_seconds = 0,
        meeting_timer_paused = false,
        meeting_timer_track = null
    where id = p_session_id;
end;
$$;

grant execute on function public.stop_meeting_timer(uuid) to authenticated;

notify pgrst, 'reload schema';
