-- Fix infinite recursion in team_members and sync_session_participants RLS policies.
-- The issue: SELECT policies on these tables reference the same table in subqueries,
-- which triggers the policy check again, causing infinite recursion.
-- The fix: security definer functions that bypass RLS for the lookup.

-- Helper: get team IDs for current user (bypasses RLS)
create or replace function public.get_my_team_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

-- Helper: get team IDs where current user is admin (bypasses RLS)
create or replace function public.get_my_admin_team_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select team_id from public.team_members where user_id = auth.uid() and role = 'admin';
$$;

-- Helper: get sync session IDs where current user is an active participant (bypasses RLS)
create or replace function public.get_my_sync_session_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select session_id from public.sync_session_participants where user_id = auth.uid() and left_at is null;
$$;

-- ── Fix team_members policies ────────────────────────────────

drop policy if exists "Members can read team members" on public.team_members;
create policy "Members can read team members"
  on public.team_members for select
  using (team_id in (select public.get_my_team_ids()));

drop policy if exists "Admins can update member roles" on public.team_members;
create policy "Admins can update member roles"
  on public.team_members for update
  using (team_id in (select public.get_my_admin_team_ids()));

drop policy if exists "Admins can remove members or self-leave" on public.team_members;
create policy "Admins can remove members or self-leave"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or team_id in (select public.get_my_admin_team_ids())
  );

-- ── Fix teams policies (also reference team_members) ─────────

drop policy if exists "Members can read their teams" on public.teams;
create policy "Members can read their teams"
  on public.teams for select
  using (id in (select public.get_my_team_ids()));

drop policy if exists "Admins can update their teams" on public.teams;
create policy "Admins can update their teams"
  on public.teams for update
  using (id in (select public.get_my_admin_team_ids()));

drop policy if exists "Admins can delete their teams" on public.teams;
create policy "Admins can delete their teams"
  on public.teams for delete
  using (id in (select public.get_my_admin_team_ids()));

-- ── Fix admin access policies on entries/user_settings/projects ──

drop policy if exists "Team admins can read member entries" on public.entries;
create policy "Team admins can read member entries"
  on public.entries for select
  using (
    user_id in (
      select tm.user_id from public.team_members tm
      where tm.team_id in (select public.get_my_admin_team_ids())
    )
  );

drop policy if exists "Team admins can read member settings" on public.user_settings;
create policy "Team admins can read member settings"
  on public.user_settings for select
  using (
    user_id in (
      select tm.user_id from public.team_members tm
      where tm.team_id in (select public.get_my_admin_team_ids())
    )
  );

drop policy if exists "Team admins can read member projects" on public.projects;
create policy "Team admins can read member projects"
  on public.projects for select
  using (
    user_id in (
      select tm.user_id from public.team_members tm
      where tm.team_id in (select public.get_my_admin_team_ids())
    )
  );

-- ── Fix sync_session_participants policies ────────────────────

drop policy if exists "Participants read members" on public.sync_session_participants;
create policy "Participants read members"
  on public.sync_session_participants for select
  using (session_id in (select public.get_my_sync_session_ids()));

-- ── Fix sync_sessions SELECT policy ──────────────────────────

drop policy if exists "Participants can read session" on public.sync_sessions;
create policy "Participants can read session"
  on public.sync_sessions for select
  using (
    auth.uid() = leader_id
    or id in (select public.get_my_sync_session_ids())
  );
