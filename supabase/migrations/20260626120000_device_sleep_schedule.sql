-- Kiosk sleep: let a device go offline at the end of the day so it isn't running
-- the call + polling 24/7. Two parts:
--   • a SCHEDULE (admin-set): active_start/active_end (wall-clock, the device's
--     local time) + active_days (0=Sun..6=Sat; null/empty = every day). Outside
--     the window the kiosk sleeps automatically and wakes again on schedule.
--   • a manual OVERRIDE (device-set): asleep_until / awake_until absolute
--     timestamps the kiosk computes when someone taps "Go offline" / "Wake" —
--     they self-expire at the next schedule boundary.
-- The kiosk evaluates "asleep" against its OWN local clock, so no timezone is
-- stored (a room display uses the room's local time).

alter table public.org_devices
  add column if not exists active_start time,
  add column if not exists active_end   time,
  add column if not exists active_days   int[],
  add column if not exists asleep_until  timestamptz,
  add column if not exists awake_until   timestamptz;

-- Device: read its own schedule + override (the otherwise write/read-less device
-- can't SELECT org_devices, so hand it just these fields).
create or replace function public.current_device_sleep()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'active_start', d.active_start,
    'active_end',   d.active_end,
    'active_days',  d.active_days,
    'asleep_until', d.asleep_until,
    'awake_until',  d.awake_until
  )
  from public.org_devices d
  where d.user_id = auth.uid() and d.revoked_at is null
  limit 1;
$$;
revoke all on function public.current_device_sleep() from public, anon;
grant execute on function public.current_device_sleep() to authenticated;

-- Device: set its own manual sleep/wake override (computed kiosk-side).
create or replace function public.device_set_sleep(p_asleep_until timestamptz, p_awake_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.org_devices%rowtype;
begin
  select * into dev
    from public.org_devices
   where user_id = auth.uid() and revoked_at is null
   limit 1;
  if dev.id is null then
    raise exception 'not a device account';
  end if;
  update public.org_devices
     set asleep_until = p_asleep_until, awake_until = p_awake_until
   where id = dev.id;
end;
$$;
revoke all on function public.device_set_sleep(timestamptz, timestamptz) from public, anon;
grant execute on function public.device_set_sleep(timestamptz, timestamptz) to authenticated;

-- Admin: set a device's active hours/days (org admins, own org only). Clearing
-- the override here too so a schedule change takes effect cleanly.
create or replace function public.admin_set_device_schedule(
  p_device_id uuid, p_start time, p_end time, p_days int[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.org_devices%rowtype;
begin
  select * into dev from public.org_devices where id = p_device_id and revoked_at is null;
  if dev.id is null then
    raise exception 'device not found';
  end if;
  if not exists (
    select 1 from public.team_members
     where team_id = dev.org_id and user_id = auth.uid()
       and (role = 'admin' or is_owner = true)
  ) then
    raise exception 'not an org admin';
  end if;
  update public.org_devices
     set active_start = p_start, active_end = p_end, active_days = p_days,
         asleep_until = null, awake_until = null
   where id = dev.id;
end;
$$;
revoke all on function public.admin_set_device_schedule(uuid, time, time, int[]) from public, anon;
grant execute on function public.admin_set_device_schedule(uuid, time, time, int[]) to authenticated;
