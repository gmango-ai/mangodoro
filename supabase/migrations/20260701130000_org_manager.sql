-- Org reporting lines: a member's manager.
--
-- Adds team_members.manager_id (the user_id of this member's manager within the
-- same org) so the org chart can render a real reporting tree, alongside the
-- existing owner/admin + department-lead roles. Nullable — most members have no
-- manager set; roots of the tree are people with manager_id null.

alter table public.team_members
  add column if not exists manager_id uuid references auth.users(id) on delete set null;

-- Surface manager_id from get_team_member_profiles. Return shape changes →
-- drop + recreate (mirrors 20260613130000_hr_fields.sql).
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
  weekly_target_hours numeric,
  manager_id uuid
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
    tm.weekly_target_hours,
    tm.manager_id
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

-- Admin-only: set (or clear, with null) a member's manager. The manager must be
-- in the same org and can't be the member themselves (a 1-step self-loop; deeper
-- cycles are guarded client-side when building the tree).
create or replace function public.set_member_manager(
  p_team_id uuid,
  p_user_id uuid,
  p_manager_id uuid
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
    raise exception 'Only org admins can set a manager';
  end if;
  if p_manager_id is not null then
    if p_manager_id = p_user_id then
      raise exception 'A member cannot manage themselves';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and user_id = p_manager_id
    ) then
      raise exception 'Manager must be a member of this org';
    end if;
  end if;
  update public.team_members
    set manager_id = p_manager_id
    where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_manager(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
