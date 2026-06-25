-- Expose working hours on the public profile (presence/time-tracking phase 3),
-- so teammates' hover cards can show "their local time · off hours". The hours
-- are set in user_settings (work_start/work_end); mirror them to profiles
-- (teammate-readable) the same way name/avatar are mirrored. Timezone is already
-- on profiles (captured by PresenceSync).

alter table public.profiles
  add column if not exists work_start time,
  add column if not exists work_end time;

create or replace function public.tg_mirror_user_settings_to_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url, work_start, work_end, updated_at)
    values (new.user_id, coalesce(new.name, ''), coalesce(new.avatar_url, ''), new.work_start, new.work_end, now())
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url   = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    work_start   = excluded.work_start,
    work_end     = excluded.work_end,
    updated_at   = now();
  return new;
end;
$$;

-- Re-fire the update trigger on work-hours changes too (was name/avatar only).
drop trigger if exists tr_mirror_us_profile_upd on public.user_settings;
create trigger tr_mirror_us_profile_upd
  after update on public.user_settings
  for each row
  when (old.name is distinct from new.name
     or old.avatar_url is distinct from new.avatar_url
     or old.work_start is distinct from new.work_start
     or old.work_end is distinct from new.work_end)
  execute function public.tg_mirror_user_settings_to_profile();

-- Backfill from existing settings.
update public.profiles p
   set work_start = us.work_start, work_end = us.work_end
  from public.user_settings us
 where us.user_id = p.user_id
   and (us.work_start is not null or us.work_end is not null);

notify pgrst, 'reload schema';
