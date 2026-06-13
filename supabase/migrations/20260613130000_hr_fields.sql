-- HR fields on org membership (team_members).
--
-- Classification distinguishes salary from hourly workers. Salary users
-- get a simpler clock-in card focused on "did I work today / how far am
-- I from my weekly target." Hourly users keep the precise time tracker.
-- Rate + target hours are admin-managed; user-facing UI shows them but
-- doesn't let the member edit their own row.

alter table public.team_members
  add column if not exists classification text not null default 'hourly',
  add column if not exists hourly_rate numeric(10, 2) not null default 0,
  add column if not exists weekly_target_hours numeric(5, 2) not null default 40;

-- Guarded check constraint so the migration is re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_classification_check'
  ) then
    alter table public.team_members
      add constraint team_members_classification_check
      check (classification in ('salary', 'hourly'));
  end if;
end $$;

-- Extend get_team_member_profiles to surface HR fields. Return shape
-- changes; drop+recreate.
drop function if exists public.get_team_member_profiles(uuid);

create function public.get_team_member_profiles(p_team_id uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  status text,
  presence_state text,
  status_updated_at timestamptz,
  role text,
  joined_at timestamptz,
  sticky_color text,
  classification text,
  hourly_rate numeric,
  weekly_target_hours numeric
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text       as name,
    coalesce(us.avatar_url, '')::text            as avatar_url,
    coalesce(us.status, '')::text                as status,
    coalesce(us.presence_state, 'active')::text  as presence_state,
    us.status_updated_at,
    tm.role,
    tm.joined_at,
    coalesce(us.sticky_color, '#fde68a')::text   as sticky_color,
    tm.classification,
    tm.hourly_rate,
    tm.weekly_target_hours
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
    and exists (
      select 1
      from public.team_members tm2
      where tm2.team_id = p_team_id
        and tm2.user_id = auth.uid()
    )
  order by tm.joined_at asc;
$$;

grant execute on function public.get_team_member_profiles(uuid) to authenticated;

-- Admin-only RPC: update a member's HR fields in one call so the UI
-- doesn't have to issue three updates.
create or replace function public.set_member_hr(
  p_team_id uuid,
  p_user_id uuid,
  p_classification text,
  p_hourly_rate numeric,
  p_weekly_target_hours numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only org admins can change HR fields';
  end if;
  if p_classification is not null
     and p_classification not in ('salary', 'hourly') then
    raise exception 'classification must be salary or hourly';
  end if;
  update public.team_members
    set classification = coalesce(p_classification, classification),
        hourly_rate = coalesce(p_hourly_rate, hourly_rate),
        weekly_target_hours = coalesce(p_weekly_target_hours, weekly_target_hours)
    where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_hr(uuid, uuid, text, numeric, numeric) to authenticated;

-- RPC the SalaryClockCard calls to compute "minutes worked this week"
-- for the caller in the given org. Reads from public.entries which is
-- the same source the time tracker uses, so salary users see their
-- actual logged work regardless of which surface they used to log it.
create or replace function public.get_my_week_minutes()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(sum(minutes), 0)::int
  from public.entries
  where user_id = auth.uid()
    and date >= date_trunc('week', current_date)::date
    and date < date_trunc('week', current_date)::date + interval '7 days';
$$;

grant execute on function public.get_my_week_minutes() to authenticated;

notify pgrst, 'reload schema';
