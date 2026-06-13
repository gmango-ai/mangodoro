-- Team-lead role helper.
--
-- `org_team_members.role` already allows ('member', 'lead') per the
-- org_teams migration, but no RPC or RLS clause checks for the 'lead'
-- value yet. This migration introduces a single helper RPC mirroring
-- `is_org_team_member` so later migrations (room gating, retro
-- archive) can keep their permission checks tight and readable.
--
-- Promotion is still gated by the existing "Org admins update
-- org_team_member role" policy on org_team_members — only org admins
-- can promote, demote, or revoke a lead.

create or replace function public.is_org_team_lead(p_org_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.org_team_members
    where org_team_id = p_org_team_id
      and user_id = auth.uid()
      and role = 'lead'
  );
$$;

grant execute on function public.is_org_team_lead(uuid) to authenticated;
