-- Phase 2: Open vs leader-led control.
--
-- Adds sync_sessions.control_mode ('open' | 'leader'). When 'open', any
-- active participant can update the timer fields (mode, sessions,
-- is_running, remaining_seconds). All other columns remain leader-only.
-- Enforced via:
--   1. A second UPDATE RLS policy allowing active participants when open.
--   2. A BEFORE UPDATE trigger that blocks non-leader writes to any
--      column other than the four timer fields.

-- ── Column ──────────────────────────────────────────────────────
alter table public.sync_sessions
  add column if not exists control_mode text not null default 'open'
  check (control_mode in ('open', 'leader'));

-- ── RLS UPDATE: participants in open mode ───────────────────────
drop policy if exists "Open mode participants update timer"
  on public.sync_sessions;
create policy "Open mode participants update timer"
  on public.sync_sessions for update
  using (
    control_mode = 'open'
    and status = 'active'
    and exists (
      select 1 from public.sync_session_participants p
      where p.session_id = id
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  )
  with check (
    control_mode = 'open'
    and status = 'active'
    and exists (
      select 1 from public.sync_session_participants p
      where p.session_id = id
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  );

-- ── Trigger: restrict participant writes to timer fields only ───
create or replace function public.sync_session_guard_participant_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Leader has full write access.
  if auth.uid() = new.leader_id then
    return new;
  end if;

  -- Non-leader participants may only change timer fields.
  if
    new.id            is distinct from old.id            or
    new.join_code     is distinct from old.join_code     or
    new.leader_id     is distinct from old.leader_id     or
    new.team_id       is distinct from old.team_id       or
    new.status        is distinct from old.status        or
    new.max_participants is distinct from old.max_participants or
    new.created_at    is distinct from old.created_at    or
    new.ended_at      is distinct from old.ended_at      or
    new.visibility    is distinct from old.visibility    or
    new.control_mode  is distinct from old.control_mode
  then
    raise exception 'Only the leader may change session metadata';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_sync_session_guard_update on public.sync_sessions;
create trigger tr_sync_session_guard_update
  before update on public.sync_sessions
  for each row
  execute function public.sync_session_guard_participant_update();

-- ── RPC: leader sets control_mode ───────────────────────────────
create or replace function public.set_sync_control_mode(
  p_session_id uuid,
  p_mode text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  if p_mode not in ('open', 'leader') then
    return json_build_object('error', 'Invalid mode');
  end if;

  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then
    return json_build_object('error', 'Session not found');
  end if;
  if v_session.leader_id <> auth.uid() then
    return json_build_object('error', 'Only the leader can change control mode');
  end if;

  update public.sync_sessions
    set control_mode = p_mode
    where id = p_session_id;

  return json_build_object('ok', true, 'control_mode', p_mode);
end;
$$;

-- ── RPC: leader sets visibility (Phase 1 companion) ─────────────
create or replace function public.set_sync_visibility(
  p_session_id uuid,
  p_visibility text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  if p_visibility not in ('team', 'invite_only') then
    return json_build_object('error', 'Invalid visibility');
  end if;

  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then
    return json_build_object('error', 'Session not found');
  end if;
  if v_session.leader_id <> auth.uid() then
    return json_build_object('error', 'Only the leader can change visibility');
  end if;

  update public.sync_sessions
    set visibility = p_visibility
    where id = p_session_id;

  return json_build_object('ok', true, 'visibility', p_visibility);
end;
$$;

notify pgrst, 'reload schema';
