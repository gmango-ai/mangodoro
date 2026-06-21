-- Leader auto-reassign + present-only fallback (room lifecycle 5/6).
--
-- Leadership only ever handed off when the leader EXPLICITLY left. A
-- leader who ghosted (closed tab) left leader_id pinned to an absent
-- person, so nobody present could start the meeting timer or attach a
-- retro — the room was leaderless in practice but not in the data.
--
-- Two complementary fixes, both keyed off the 120s heartbeat liveness:
--   • claim_session_lead(): the gate for leader-only actions. You pass if
--     you're the leader, OR the leader is away (stale heartbeat) and
--     you're a present participant — in which case you take the chair.
--   • reassign_stale_leaders(): periodic (run from the sweep) handoff of
--     any session whose leader is away to its longest-present member, so
--     leader_id proactively tracks who's actually there.
--
-- GRACE WINDOW 120s — keep in sync with the other lifecycle functions and
-- PRESENCE_GRACE_MS in src/lib/syncSession.js.

-- ── Gate: may the caller act as leader right now? ──────────────────────
-- Promotes the caller when the leader is away (auth.uid() = new.leader_id,
-- so this self-promotion satisfies the metadata guard on its own; we set
-- the bypass flag anyway for robustness).
create or replace function public.claim_session_lead(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leader uuid;
  v_leader_live boolean;
  v_caller_active boolean;
begin
  select leader_id into v_leader from public.sync_sessions where id = p_session_id;
  if not found then
    return false;
  end if;

  -- Already the leader → full rights.
  if v_leader = auth.uid() then
    return true;
  end if;

  -- Is the current leader present (fresh heartbeat)?
  select exists (
    select 1 from public.sync_session_participants
    where session_id = p_session_id
      and user_id = v_leader
      and left_at is null
      and last_seen_at > pg_catalog.now() - interval '120 seconds'
  ) into v_leader_live;

  -- A present leader keeps exclusive control.
  if v_leader_live then
    return false;
  end if;

  -- Leader is away. Any active participant (the caller is here, making
  -- this request) may take the reins.
  select exists (
    select 1 from public.sync_session_participants
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null
  ) into v_caller_active;
  if not v_caller_active then
    return false;
  end if;

  perform set_config('sync.internal_update', '1', true);
  update public.sync_sessions
    set leader_id = auth.uid(),
        controller_id = case when controller_id = v_leader then auth.uid() else controller_id end
    where id = p_session_id;
  return true;
end;
$$;

grant execute on function public.claim_session_lead(uuid) to authenticated;

-- ── Periodic handoff: stale leader → longest-present member ────────────
create or replace function public.reassign_stale_leaders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new_leader uuid;
  v_count int := 0;
begin
  perform set_config('sync.internal_update', '1', true);
  for r in
    select s.id, s.leader_id
    from public.sync_sessions s
    where s.status = 'active'
      and not exists (
        select 1 from public.sync_session_participants p
        where p.session_id = s.id
          and p.user_id = s.leader_id
          and p.left_at is null
          and p.last_seen_at > pg_catalog.now() - interval '120 seconds'
      )
  loop
    select user_id into v_new_leader
    from public.sync_session_participants
    where session_id = r.id
      and left_at is null
      and last_seen_at > pg_catalog.now() - interval '120 seconds'
    order by joined_at asc
    limit 1;

    -- Null → no live member; leave it for the abandoned-session sweep.
    if v_new_leader is not null and v_new_leader <> r.leader_id then
      update public.sync_sessions
        set leader_id = v_new_leader,
            controller_id = case when controller_id = r.leader_id then v_new_leader else controller_id end
        where id = r.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.reassign_stale_leaders() to authenticated;

-- Fold reassignment into the scheduled sweep: hand off stale leaders
-- first, then delete the genuinely-empty / expired sessions.
create or replace function public.sweep_sync_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reassign_stale_leaders();
  return public.sweep_abandoned_sync_sessions()
       + public.sweep_expired_sync_sessions();
end;
$$;

grant execute on function public.sweep_sync_sessions() to authenticated;

-- ── Re-gate the leader-only action RPCs on claim_session_lead ──────────
-- Behaviour change: when the leader is away, a present participant may
-- start/control the meeting timer and attach/detach a retro (and thereby
-- becomes the leader). When the leader IS present, these stay leader-only.

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
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can start the timer';
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
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can pause the timer';
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
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can resume the timer';
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
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can stop the timer';
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

create or replace function public.link_retro_to_session(
  p_session_id uuid,
  p_retro_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_retro public.retros;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can link a retro';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;

  select * into v_retro from public.retros where id = p_retro_id;
  if not found then raise exception 'Retro not found'; end if;

  if v_session.team_id is null or v_retro.team_id <> v_session.team_id then
    raise exception 'Retro and session must belong to the same team';
  end if;

  update public.sync_sessions
    set retro_id = p_retro_id
    where id = p_session_id;
end;
$$;

create or replace function public.unlink_retro_from_session(p_session_id uuid)
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
  if not public.claim_session_lead(p_session_id) then
    raise exception 'Only the room host (or, when they are away, someone present) can unlink the retro';
  end if;

  update public.sync_sessions
    set retro_id = null
    where id = p_session_id;
end;
$$;

notify pgrst, 'reload schema';
