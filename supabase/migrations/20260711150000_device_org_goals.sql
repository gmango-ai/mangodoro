-- Org goals for a kiosk ticker line. A device can't read the org's `goals`
-- table under its least-privilege RLS (team-member scoped), so expose the
-- active, non-private goals via ONE security-definer RPC, gated to the calling
-- device's own org — the same pattern as device_team_roster.
--
-- Only a real device (is_device_user) gets rows, and only for its org
-- (current_device_org); a non-device gets none.

create or replace function public.device_org_goals()
returns table (
  id          uuid,
  body        text,
  owner_name  text,
  owner_type  text,
  horizon     text,
  pinned      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.body, coalesce(g.owner_name, ''), g.owner_type, g.horizon, coalesce(g.pinned, false)
  from public.goals g
  where public.is_device_user()
    and g.team_id = public.current_device_org()
    and coalesce(g.status, 'active') <> 'done'
    and coalesce(g.is_public, true) = true
    and btrim(coalesce(g.body, '')) <> ''
  order by coalesce(g.pinned, false) desc, g.position asc nulls last, g.set_at desc
  limit 40;
$$;

grant execute on function public.device_org_goals() to authenticated;
