-- First-class person identity: a public-ish `profiles` table.
--
-- Until now identity (name, avatar) lived on the PRIVATE user_settings table,
-- read by teammates only via the get_team_member_profiles RPC. profiles makes
-- identity first-class and readable by anyone you share a team with — the
-- foundation for @mention links, a profile card/page, and (later) DMs +
-- calendar. Org-scoped attributes (role, employment) stay on team_members.
--
-- Transition is non-destructive: user_settings keeps name/avatar; a trigger
-- mirrors edits into profiles so existing writers keep it fresh.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text not null default '',
  handle       text unique,                 -- optional @handle (future)
  timezone     text,                         -- IANA tz (future scheduling/reminders)
  bio          text,
  kind         text not null default 'person' check (kind in ('person', 'device')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Backfill identity from user_settings.
insert into public.profiles (user_id, display_name, avatar_url)
  select us.user_id, coalesce(us.name, ''), coalesce(us.avatar_url, '')
    from public.user_settings us
  on conflict (user_id) do nothing;

-- Mirror user_settings name/avatar edits into profiles (transition shim).
create or replace function public.tg_mirror_user_settings_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url, updated_at)
    values (new.user_id, coalesce(new.name, ''), coalesce(new.avatar_url, ''), now())
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url   = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at   = now();
  return new;
end;
$$;

drop trigger if exists tr_mirror_us_profile_ins on public.user_settings;
create trigger tr_mirror_us_profile_ins
  after insert on public.user_settings
  for each row execute function public.tg_mirror_user_settings_to_profile();

drop trigger if exists tr_mirror_us_profile_upd on public.user_settings;
create trigger tr_mirror_us_profile_upd
  after update on public.user_settings
  for each row
  when (old.name is distinct from new.name or old.avatar_url is distinct from new.avatar_url)
  execute function public.tg_mirror_user_settings_to_profile();

-- Realtime (a profile edit reflects live in open cards/pages).
alter table public.profiles replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

alter table public.profiles enable row level security;

-- Read your own profile, or anyone you share a team with.
drop policy if exists "read own or shared-team profiles" on public.profiles;
create policy "read own or shared-team profiles"
  on public.profiles for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
        from public.team_members me
       where me.user_id = auth.uid()
         and me.team_id in (
           select t.team_id from public.team_members t where t.user_id = profiles.user_id
         )
    )
  );

drop policy if exists "owner updates own profile" on public.profiles;
create policy "owner updates own profile"
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "owner inserts own profile" on public.profiles;
create policy "owner inserts own profile"
  on public.profiles for insert
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
