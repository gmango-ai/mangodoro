-- Team member profile RPC + realtime on team_members.
--
-- Background: the `user_settings` RLS only exposes co-member rows to team
-- admins, so regular members couldn't load their teammates' names /
-- avatars / statuses (a left-join from team_members → user_settings just
-- returned nulls). This security-definer RPC returns a sanitized profile
-- per team member, gated by "caller must be a member of the team".

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
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  -- Gate: caller must be a member of the team they're querying.
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  ) then
    return;
  end if;

  return query
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text         as name,
    coalesce(us.avatar_url, '')::text              as avatar_url,
    coalesce(us.status, '')::text                  as status,
    coalesce(us.presence_state, 'active')::text    as presence_state,
    us.status_updated_at,
    tm.role,
    tm.joined_at
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
  order by tm.joined_at asc;
end;
$$;

grant execute on function public.get_team_member_profiles(uuid) to authenticated;

-- Enable realtime on team_members so the team page updates instantly
-- when someone joins or leaves, without a manual reload.
alter table public.team_members replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end $$;

notify pgrst, 'reload schema';
