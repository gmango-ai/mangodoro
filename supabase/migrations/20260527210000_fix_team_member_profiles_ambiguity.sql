-- Fix "column reference user_id is ambiguous" in get_team_member_profiles.
--
-- The previous version was PL/pgSQL with `RETURNS TABLE (user_id uuid, ...)`.
-- Those OUT column names become variables inside the function body, which
-- shadows `team_members.user_id` and makes references ambiguous.
-- Rewriting as a plain SQL function — those don't have the shadowing
-- behavior — keeps the public contract identical.

create or replace function public.get_team_member_profiles(p_team_id uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  status text,
  presence_state text,
  status_updated_at timestamptz,
  role text,
  joined_at timestamptz
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
    tm.joined_at
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
    -- Gate: the caller must be a member of the team they're querying.
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
