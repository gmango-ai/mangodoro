-- Goals authorization hardening. Previously every goal write RPC was gated by
-- team MEMBERSHIP only, so any member could mutate the company goal, any
-- department's goals, or another user's PRIVATE personal goal by calling the
-- RPC directly (the UI only hid the buttons). Gate writes by authority:
--   company    → team admin
--   department → team admin OR that department's lead
--   user       → the owner themselves (in a team they belong to) OR a team admin

create or replace function public.can_manage_goal_owner(p_team_id uuid, p_owner_type text, p_owner_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select case
    when p_owner_type = 'company'    then p_team_id in (select public.get_my_admin_team_ids())
    when p_owner_type = 'department' then (p_team_id in (select public.get_my_admin_team_ids()) or public.is_org_team_lead(p_owner_id))
    when p_owner_type = 'user'       then ((p_owner_id = auth.uid() and p_team_id in (select public.get_my_team_ids())) or p_team_id in (select public.get_my_admin_team_ids()))
    else false
  end;
$$;
grant execute on function public.can_manage_goal_owner(uuid, text, uuid) to authenticated;

-- can_edit_goal now reflects owner authority (was: any team member). This also
-- fixes the key-result RPCs (add/update/delete_key_result call it).
create or replace function public.can_edit_goal(p_goal_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id and public.can_manage_goal_owner(g.team_id, g.owner_type, g.owner_id)
  );
$$;

-- create_goal: must be able to manage the requested owner.
create or replace function public.create_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text, p_horizon text default 'none'
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not public.can_manage_goal_owner(p_team_id, p_owner_type, p_owner_id) then
    raise exception 'Not permitted to set goals for this owner';
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, horizon, set_by, set_at, position)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(coalesce(p_body, '')),
          coalesce(nullif(p_horizon, ''), 'none'), auth.uid(), now(),
          coalesce((select max(position) + 1 from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id), 0))
  returning * into v_row;
  return v_row;
end; $$;

-- update_goal: must be able to manage the goal's owner.
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null,
  p_is_public boolean default null, p_horizon text default null,
  p_pinned boolean default null, p_health text default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not public.can_edit_goal(p_id) then
    raise exception 'Goal not found or not permitted';
  end if;
  if p_status is not null and p_status not in ('active', 'done') then raise exception 'Invalid status'; end if;
  if p_horizon is not null and p_horizon not in ('none', 'week', 'month', 'quarter', 'year') then raise exception 'Invalid horizon'; end if;
  if p_health is not null and p_health not in ('none', 'on_track', 'at_risk', 'off_track') then raise exception 'Invalid health'; end if;
  update public.goals g
     set body = case when p_body is not null then btrim(p_body) else g.body end,
         status = coalesce(p_status, g.status),
         is_public = coalesce(p_is_public, g.is_public),
         horizon = coalesce(p_horizon, g.horizon),
         pinned = coalesce(p_pinned, g.pinned),
         health = coalesce(p_health, g.health),
         completed_at = case when p_status = 'done' then now() when p_status = 'active' then null else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;

-- delete_goal
create or replace function public.delete_goal(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_goal(p_id) then raise exception 'Goal not found or not permitted'; end if;
  delete from public.goals where id = p_id;
end; $$;

-- reorder_goals: every id must be manageable by the caller.
create or replace function public.reorder_goals(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(p_ids) as want(id) where not public.can_edit_goal(want.id)) then
    raise exception 'Goal not found or not permitted';
  end if;
  update public.goals g
     set position = idx.ord
    from (select t.id, (t.ord - 1) as ord from unnest(p_ids) with ordinality as t(id, ord)) idx
   where g.id = idx.id;
end; $$;

-- reassign_goal: manage BOTH source + target, and the target owner must be real.
create or replace function public.reassign_goal(
  p_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text default null, p_owner_color text default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals; v_team uuid;
begin
  if p_owner_type not in ('company', 'department', 'user') then raise exception 'Invalid owner type'; end if;
  select team_id into v_team from public.goals where id = p_id;
  if v_team is null then raise exception 'Goal not found'; end if;
  if not public.can_edit_goal(p_id) then raise exception 'Not permitted to move this goal'; end if;
  if not public.can_manage_goal_owner(v_team, p_owner_type, p_owner_id) then raise exception 'Not permitted to move to that owner'; end if;
  -- target owner must be real within this org
  if p_owner_type = 'company' and p_owner_id <> v_team then raise exception 'Invalid company owner'; end if;
  if p_owner_type = 'department' and not exists (select 1 from public.org_teams ot where ot.id = p_owner_id and ot.org_id = v_team) then raise exception 'Invalid department'; end if;
  if p_owner_type = 'user' and not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.user_id = p_owner_id) then raise exception 'Invalid user'; end if;
  update public.goals g
     set owner_type = p_owner_type, owner_id = p_owner_id,
         owner_name = coalesce(nullif(btrim(coalesce(p_owner_name, '')), ''), g.owner_name),
         owner_color = coalesce(p_owner_color, g.owner_color),
         position = coalesce((select max(position) + 1 from public.goals where team_id = v_team and owner_type = p_owner_type and owner_id = p_owner_id), 0)
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;

-- set_goal_rooms
create or replace function public.set_goal_rooms(p_goal_id uuid, p_room_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_goal(p_goal_id) then raise exception 'Goal not found or not permitted'; end if;
  delete from public.goal_rooms where goal_id = p_goal_id;
  insert into public.goal_rooms (goal_id, room_id)
    select p_goal_id, r from unnest(coalesce(p_room_ids, '{}'::uuid[])) as r
    where r in (select id from public.rooms where team_id in (select public.get_my_team_ids()));
end; $$;

notify pgrst, 'reload schema';
