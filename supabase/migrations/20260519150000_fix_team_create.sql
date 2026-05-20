-- Fix: team creator needs to read back the team before the membership row exists.
-- Allow creators to always read their own teams.

drop policy if exists "Members can read their teams" on public.teams;
create policy "Members can read their teams"
  on public.teams for select
  using (
    auth.uid() = created_by
    or id in (select public.get_my_team_ids())
  );
