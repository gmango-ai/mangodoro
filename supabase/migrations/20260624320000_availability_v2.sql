-- Availability v2: per-day working hours + location (office/home), and multiple
-- out-of-office ranges. New jsonb columns supersede the single work_start/end +
-- work_days + ooo_start/end/note (kept for back-compat / fallback).
--   work_schedule: { "1": {start:"09:00", end:"17:00", loc:"office"}, ... }  (0=Sun..6=Sat; absent day = off)
--   ooo_ranges:    [ { id, start, end, note }, ... ]
alter table public.user_settings
  add column if not exists work_schedule jsonb not null default '{}'::jsonb,
  add column if not exists ooo_ranges jsonb not null default '[]'::jsonb;
alter table public.profiles
  add column if not exists work_schedule jsonb not null default '{}'::jsonb,
  add column if not exists ooo_ranges jsonb not null default '[]'::jsonb;

-- Backfill per-day schedule from the old single hours × work_days (default M–F).
update public.user_settings us
   set work_schedule = (
     select coalesce(jsonb_object_agg(d::text, jsonb_build_object(
       'start', to_char(us.work_start, 'HH24:MI'),
       'end',   to_char(us.work_end, 'HH24:MI'),
       'loc',   'office')), '{}'::jsonb)
     from unnest(coalesce(us.work_days, array[1, 2, 3, 4, 5])) as d
   )
 where us.work_start is not null and us.work_end is not null
   and (us.work_schedule = '{}'::jsonb);

-- Backfill the single OOO into the ranges list.
update public.user_settings us
   set ooo_ranges = jsonb_build_array(jsonb_build_object(
     'id', gen_random_uuid()::text,
     'start', us.ooo_start::text,
     'end', us.ooo_end::text,
     'note', coalesce(us.ooo_note, '')))
 where (us.ooo_start is not null or us.ooo_end is not null)
   and (us.ooo_ranges = '[]'::jsonb);

create or replace function public.tg_mirror_user_settings_to_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles
    (user_id, display_name, avatar_url, work_start, work_end, work_days, work_schedule,
     timezone, off_hours_warn, ooo_start, ooo_end, ooo_note, ooo_ranges, updated_at)
  values
    (new.user_id, coalesce(new.name, ''), coalesce(new.avatar_url, ''), new.work_start, new.work_end, new.work_days, new.work_schedule,
     new.timezone, new.off_hours_warn, new.ooo_start, new.ooo_end, new.ooo_note, new.ooo_ranges, now())
  on conflict (user_id) do update set
    display_name   = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url     = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    work_start     = excluded.work_start,
    work_end       = excluded.work_end,
    work_days      = excluded.work_days,
    work_schedule  = excluded.work_schedule,
    timezone       = coalesce(excluded.timezone, public.profiles.timezone),
    off_hours_warn = excluded.off_hours_warn,
    ooo_start      = excluded.ooo_start,
    ooo_end        = excluded.ooo_end,
    ooo_note       = excluded.ooo_note,
    ooo_ranges     = excluded.ooo_ranges,
    updated_at     = now();
  return new;
end;
$$;

drop trigger if exists tr_mirror_us_profile_upd on public.user_settings;
create trigger tr_mirror_us_profile_upd
  after update on public.user_settings
  for each row
  when (old.name is distinct from new.name
     or old.avatar_url is distinct from new.avatar_url
     or old.work_start is distinct from new.work_start
     or old.work_end is distinct from new.work_end
     or old.work_days is distinct from new.work_days
     or old.work_schedule is distinct from new.work_schedule
     or old.timezone is distinct from new.timezone
     or old.off_hours_warn is distinct from new.off_hours_warn
     or old.ooo_start is distinct from new.ooo_start
     or old.ooo_end is distinct from new.ooo_end
     or old.ooo_note is distinct from new.ooo_note
     or old.ooo_ranges is distinct from new.ooo_ranges)
  execute function public.tg_mirror_user_settings_to_profile();

notify pgrst, 'reload schema';
