-- Status-system rewrite, P3 (docs/plans/status-system-rewrite.md).
-- Server-side sweep: a closed tab / asleep computer can't report its own
-- death, so the leader tab heartbeats last_seen_at (P2) and this job flips
-- stale rows to 'offline' — plus expires overrides and pins whose deadline
-- passed. Runs every minute via pg_cron. (The roster still shows offline
-- instantly via realtime liveness; this makes the DB row itself correct for
-- server-side readers / the notification router.)

create or replace function public.sweep_presence()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Disconnected clients → offline (no heartbeat within 90s).
  update public.user_presence
     set availability = 'offline', updated_at = now()
   where availability <> 'offline'
     and (last_seen_at is null or last_seen_at < now() - interval '90 seconds');

  -- Expire manual overrides whose deadline passed.
  update public.user_presence
     set override_availability = null,
         override_message = null,
         override_emoji = null,
         override_expires_at = null,
         override_set_at = null,
         updated_at = now()
   where override_expires_at is not null
     and override_expires_at < now();

  -- Expire auto-state pins ("keep my status") once their day is up.
  update public.user_presence
     set auto_pin_until = null, updated_at = now()
   where auto_pin_until is not null
     and auto_pin_until < now();
end;
$fn$;

-- (Re)schedule the minute cron. Unschedule first so re-applying is idempotent.
do $cron$
begin
  perform cron.unschedule('presence-sweep');
exception when others then
  null; -- not scheduled yet
end
$cron$;

select cron.schedule('presence-sweep', '* * * * *', $job$select public.sweep_presence()$job$);
