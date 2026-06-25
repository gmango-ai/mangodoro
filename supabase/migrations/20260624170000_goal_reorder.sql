-- Goals: explicit ordering. Owners can arrange their goals / pin important
-- ones to the top. `position` (added in 20260624120000) becomes the canonical
-- sort key; reorder_goals rewrites it from a caller-supplied id order.

-- list_team_goals: order by position, then recency as a tiebreak. Keeps the
-- private-user-goal filter from 20260624130000.
create or replace function public.list_team_goals(p_team_id uuid)
returns setof public.goals language sql security definer set search_path = '' as $$
  select * from public.goals
  where team_id = p_team_id and team_id in (select public.get_my_team_ids())
    and (owner_type <> 'user' or owner_id = auth.uid() or is_public)
  order by position asc, set_at desc;
$$;
grant execute on function public.list_team_goals(uuid) to authenticated;

-- Reorder a set of goals: position = array index (0-based). Every id must
-- belong to a team the caller is a member of.
create or replace function public.reorder_goals(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from unnest(p_ids) as want(id)
    where want.id not in (select g.id from public.goals g where g.team_id in (select public.get_my_team_ids()))
  ) then
    raise exception 'Goal not found or not permitted';
  end if;
  update public.goals g
     set position = idx.ord
    from (select t.id, (t.ord - 1) as ord from unnest(p_ids) with ordinality as t(id, ord)) idx
   where g.id = idx.id;
end; $$;
grant execute on function public.reorder_goals(uuid[]) to authenticated;

notify pgrst, 'reload schema';
