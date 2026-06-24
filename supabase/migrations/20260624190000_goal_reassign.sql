-- Goals: reassign a goal to a different owner — move between the company and
-- departments (re-org), or elevate a personal goal into a team/department goal.
-- Stays within the same team_id (org); changes owner_type/owner_id/name/color
-- and drops the goal at the end of the new owner's list.

create or replace function public.reassign_goal(
  p_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text default null, p_owner_color text default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals; v_team uuid;
begin
  if p_owner_type not in ('company', 'department', 'user') then
    raise exception 'Invalid owner type';
  end if;
  select team_id into v_team from public.goals where id = p_id;
  if v_team is null or not (v_team in (select public.get_my_team_ids())) then
    raise exception 'Goal not found or not permitted';
  end if;
  update public.goals g
     set owner_type = p_owner_type,
         owner_id = p_owner_id,
         owner_name = coalesce(nullif(btrim(coalesce(p_owner_name, '')), ''), g.owner_name),
         owner_color = coalesce(p_owner_color, g.owner_color),
         position = coalesce(
           (select max(position) + 1 from public.goals
             where team_id = v_team and owner_type = p_owner_type and owner_id = p_owner_id),
           0)
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.reassign_goal(uuid, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
