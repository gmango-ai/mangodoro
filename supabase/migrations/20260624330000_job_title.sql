-- Job title on the profile (identity). Stored on user_settings, mirrored to
-- profiles (teammate-readable) alongside name/avatar — shown on the hover card,
-- profile page, and a future org chart.
alter table public.user_settings add column if not exists job_title text;
alter table public.profiles add column if not exists job_title text;

create or replace function public.tg_mirror_user_settings_to_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles
    (user_id, display_name, avatar_url, job_title, work_start, work_end, work_days, work_schedule,
     timezone, off_hours_warn, ooo_start, ooo_end, ooo_note, ooo_ranges, updated_at)
  values
    (new.user_id, coalesce(new.name, ''), coalesce(new.avatar_url, ''), new.job_title, new.work_start, new.work_end, new.work_days, new.work_schedule,
     new.timezone, new.off_hours_warn, new.ooo_start, new.ooo_end, new.ooo_note, new.ooo_ranges, now())
  on conflict (user_id) do update set
    display_name   = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url     = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    job_title      = excluded.job_title,
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
     or old.job_title is distinct from new.job_title
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
