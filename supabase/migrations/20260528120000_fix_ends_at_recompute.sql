-- Fix: the timer resets whenever an unrelated column is updated.
--
-- Both ends_at triggers recomputed `ends_at = now() + remaining_seconds`
-- on EVERY update. While a timer is running, `remaining_seconds` holds the
-- value from when it was last started (e.g. 1500) — the live countdown is
-- derived client-side from `ends_at`, and remaining_seconds is NOT
-- continuously flushed. So any update to a non-timer column (control_mode,
-- visibility, leader_id, status, etc.) caused the BEFORE UPDATE trigger to
-- recompute ends_at = now() + 1500s, restarting the countdown from full.
--
-- Fix: only recompute ends_at when the timer state actually changes — i.e.
-- is_running or remaining_seconds is different from the previous row (or on
-- INSERT). Updates that don't touch those fields leave ends_at untouched,
-- so the countdown keeps running.

create or replace function public.sync_session_set_ends_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.is_running is distinct from old.is_running
     or new.remaining_seconds is distinct from old.remaining_seconds
  then
    if new.is_running and new.remaining_seconds is not null then
      new.ends_at := pg_catalog.now() + (new.remaining_seconds * interval '1 second');
    else
      new.ends_at := null;
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.user_pomodoro_state_set_ends_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.is_running is distinct from old.is_running
     or new.remaining_seconds is distinct from old.remaining_seconds
  then
    if new.is_running and new.remaining_seconds is not null then
      new.ends_at := pg_catalog.now() + (new.remaining_seconds * interval '1 second');
    else
      new.ends_at := null;
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
