-- Department tags on teams and team_members.
--
-- teams.departments is the team-wide canonical list of department names
-- (admin-curated). Member tags must come from this list — admins manage
-- both the list and the per-member assignments in the team page. Existing
-- RLS on teams (admins-only update) and team_members (admins-only update
-- for non-self) already covers writes; no policy changes needed.

alter table public.teams
  add column if not exists departments text[] not null default '{}'::text[];

alter table public.team_members
  add column if not exists departments text[] not null default '{}'::text[];

-- Extend the get_team_member_profiles RPC to surface each member's
-- department tags. UI reads through this RPC because user_settings RLS
-- doesn't expose co-member rows to non-admins, but the RPC's security
-- definer + caller-is-team-member gate covers the gap.
--
-- DROP FUNCTION is required because we're changing the RETURNS TABLE
-- shape (adding `departments text[]`). CREATE OR REPLACE only allows
-- body changes, not signature changes.

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
  departments text[]
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
    tm.departments
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

notify pgrst, 'reload schema';
