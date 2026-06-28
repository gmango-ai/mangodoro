-- Goals: week binding (this week / next week).
--
-- `horizon` was only a label (none|week|month|quarter|year) — "week" couldn't
-- tell THIS week from NEXT week. Add `week_start` (the Monday of the target
-- week) so a goal can be scheduled for the current or following week, and the
-- office/pomodoro surfacing can roll over automatically each Monday.
--
-- Convention: week_start is set only when horizon = 'week'. All the write RPCs
-- derive it from horizon so the two never drift.

alter table public.goals
  add column if not exists week_start date;

create index if not exists goals_week_start_idx
  on public.goals (team_id, week_start) where week_start is not null;

-- ── set_goal (whiteboard path): gains p_horizon + p_week_start ──────
drop function if exists public.set_goal(uuid, text, uuid, text, text, text, uuid, text);
create or replace function public.set_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text,
  p_board uuid default null, p_node text default null,
  p_horizon text default 'none', p_week_start date default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_horizon text := coalesce(nullif(p_horizon, ''), 'none');
  v_week date := case when coalesce(nullif(p_horizon, ''), 'none') = 'week' then p_week_start else null end;
begin
  if not (p_team_id in (select public.get_my_team_ids())) then
    raise exception 'Not a member of this team';
  end if;
  if v_horizon not in ('none', 'week', 'month', 'quarter', 'year') then
    raise exception 'Invalid horizon';
  end if;
  -- Empty body clears this node's goal.
  if coalesce(btrim(p_body), '') = '' then
    delete from public.goals where source_board = p_board and source_node = p_node and p_node is not null;
    return;
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, horizon, week_start, set_by, set_at, source_board, source_node)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(p_body), v_horizon, v_week, auth.uid(), now(), p_board, p_node)
  on conflict (source_board, source_node) where source_node is not null
  do update set team_id = excluded.team_id, owner_type = excluded.owner_type, owner_id = excluded.owner_id,
                owner_name = excluded.owner_name, owner_color = excluded.owner_color,
                body = excluded.body, horizon = excluded.horizon, week_start = excluded.week_start,
                set_by = excluded.set_by, set_at = now();
end; $$;
grant execute on function public.set_goal(uuid, text, uuid, text, text, text, uuid, text, text, date) to authenticated;

-- ── create_goal: gains p_week_start (keeps the 20260624200000 authz) ──
drop function if exists public.create_goal(uuid, text, uuid, text, text, text, text);
create or replace function public.create_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text,
  p_horizon text default 'none', p_week_start date default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare
  v_row public.goals;
  v_horizon text := coalesce(nullif(p_horizon, ''), 'none');
  v_week date := case when coalesce(nullif(p_horizon, ''), 'none') = 'week' then p_week_start else null end;
begin
  if not public.can_manage_goal_owner(p_team_id, p_owner_type, p_owner_id) then
    raise exception 'Not permitted to set goals for this owner';
  end if;
  if v_horizon not in ('none', 'week', 'month', 'quarter', 'year') then
    raise exception 'Invalid horizon';
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, horizon, week_start, set_by, set_at, position)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(coalesce(p_body, '')),
          v_horizon, v_week, auth.uid(), now(),
          coalesce((select max(position) + 1 from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id), 0))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_goal(uuid, text, uuid, text, text, text, text, date) to authenticated;

-- ── update_goal: gains p_week_start (keeps the 20260624200000 authz) ──
drop function if exists public.update_goal(uuid, text, text, boolean, text, boolean, text);
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null,
  p_is_public boolean default null, p_horizon text default null,
  p_pinned boolean default null, p_health text default null,
  p_week_start date default null
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
         -- week_start is derived from horizon: only a 'week' horizon keeps a
         -- date. When horizon isn't being changed, leave week_start alone.
         week_start = case
           when p_horizon is null then g.week_start
           when p_horizon = 'week' then p_week_start
           else null
         end,
         pinned = coalesce(p_pinned, g.pinned),
         health = coalesce(p_health, g.health),
         completed_at = case when p_status = 'done' then now() when p_status = 'active' then null else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text, boolean, text, boolean, text, date) to authenticated;

notify pgrst, 'reload schema';
