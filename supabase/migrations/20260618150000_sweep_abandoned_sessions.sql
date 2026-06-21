-- Safety-net sweep for abandoned room sessions (room lifecycle 4/6).
--
-- Explicit leave + read-time liveness + reconcile-on-start handle the
-- cases where *someone is online*. This is the backstop for when nobody
-- is: if every participant's tab is closed/suspended (all heartbeats
-- stale) the session would otherwise linger forever — timer frozen,
-- private room locked, video bridge potentially still up. The sweep
-- deletes any active session with no live participant, which (via the
-- existing BEFORE DELETE trigger + cascade) unlocks the private room and
-- clears participant rows. Combined with reset-to-zero, a returning user
-- gets a clean room.
--
-- GRACE WINDOW 120s — keep in sync with reconcile_room_session /
-- leave_sync_session and PRESENCE_GRACE_MS in src/lib/syncSession.js.

create or replace function public.sweep_abandoned_sync_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with abandoned as (
    select s.id
    from public.sync_sessions s
    where s.status = 'active'
      and not exists (
        select 1
        from public.sync_session_participants p
        where p.session_id = s.id
          and p.left_at is null
          and p.last_seen_at > pg_catalog.now() - interval '120 seconds'
      )
  ),
  deleted as (
    delete from public.sync_sessions
    where id in (select id from abandoned)
    returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

grant execute on function public.sweep_abandoned_sync_sessions() to authenticated;

-- Single entry point for the scheduler: sweep both abandoned (empty) and
-- expired (meeting-duration) sessions in one call. Returns the total
-- number of sessions deleted.
create or replace function public.sweep_sync_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.sweep_abandoned_sync_sessions()
       + public.sweep_expired_sync_sessions();
end;
$$;

grant execute on function public.sweep_sync_sessions() to authenticated;

-- ── Schedule it server-side (the "nobody is online" guarantee) ─────────
--
-- pg_cron is the only in-database scheduler on Supabase (the dashboard
-- "cron" UI and any pg_net-driven edge-function trigger are pg_cron
-- underneath). We wire it here best-effort: if the extension can't be
-- created in this environment (local stack without pg_cron, restricted
-- role), the DO block swallows the error so `supabase db push` still
-- succeeds, and the NOTICE tells the operator how to finish wiring it.
--
-- Runs every minute; both sweeps are cheap (indexed on
-- sync_participants_last_seen_active / sync_sessions_*_active).
do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'sweep-sync-sessions') then
    perform cron.unschedule('sweep-sync-sessions');
  end if;

  perform cron.schedule(
    'sweep-sync-sessions',
    '* * * * *',
    'select public.sweep_sync_sessions();'
  );

  raise notice 'Scheduled pg_cron job "sweep-sync-sessions" (every minute).';
exception when others then
  raise notice 'Could not auto-schedule the session sweep via pg_cron (%). Enable the pg_cron extension, then run: select cron.schedule(''sweep-sync-sessions'', ''* * * * *'', ''select public.sweep_sync_sessions();'');', sqlerrm;
end $$;
