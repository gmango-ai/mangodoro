-- Goals expansion, Stage C: progress via key results + a health signal.
--
-- A goal can have measurable key results (each a current/target number with an
-- optional unit) — goal progress = average of its KRs. A manual `health` signal
-- (on_track / at_risk / off_track) lets owners flag status independent of the
-- raw number.

alter table public.goals
  add column if not exists health text not null default 'none'
    check (health in ('none', 'on_track', 'at_risk', 'off_track'));

create table if not exists public.goal_key_results (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  body text not null default '',
  target numeric,
  current numeric not null default 0,
  unit text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists goal_key_results_goal_idx on public.goal_key_results(goal_id);
alter table public.goal_key_results enable row level security;

-- Team members read KRs for goals in their team. Writes go through the RPCs.
drop policy if exists "Team members read goal_key_results" on public.goal_key_results;
create policy "Team members read goal_key_results" on public.goal_key_results
  for select using (
    goal_id in (select id from public.goals where team_id in (select public.get_my_team_ids()))
  );

-- update_goal gains p_health (drop+recreate to change the signature).
drop function if exists public.update_goal(uuid, text, text, boolean, text, boolean);
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null,
  p_is_public boolean default null, p_horizon text default null,
  p_pinned boolean default null, p_health text default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not exists (select 1 from public.goals g where g.id = p_id and g.team_id in (select public.get_my_team_ids())) then
    raise exception 'Goal not found or not permitted';
  end if;
  if p_status is not null and p_status not in ('active', 'done') then
    raise exception 'Invalid status';
  end if;
  if p_horizon is not null and p_horizon not in ('none', 'week', 'month', 'quarter', 'year') then
    raise exception 'Invalid horizon';
  end if;
  if p_health is not null and p_health not in ('none', 'on_track', 'at_risk', 'off_track') then
    raise exception 'Invalid health';
  end if;
  update public.goals g
     set body = case when p_body is not null then btrim(p_body) else g.body end,
         status = coalesce(p_status, g.status),
         is_public = coalesce(p_is_public, g.is_public),
         horizon = coalesce(p_horizon, g.horizon),
         pinned = coalesce(p_pinned, g.pinned),
         health = coalesce(p_health, g.health),
         completed_at = case when p_status = 'done' then now()
                             when p_status = 'active' then null
                             else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text, boolean, text, boolean, text) to authenticated;

-- helper: caller is a member of the team that owns this goal.
create or replace function public.can_edit_goal(p_goal_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id and g.team_id in (select public.get_my_team_ids())
  );
$$;
grant execute on function public.can_edit_goal(uuid) to authenticated;

create or replace function public.add_key_result(
  p_goal_id uuid, p_body text, p_target numeric default null, p_unit text default ''
)
returns public.goal_key_results language plpgsql security definer set search_path = '' as $$
declare v_row public.goal_key_results;
begin
  if not public.can_edit_goal(p_goal_id) then raise exception 'Goal not found or not permitted'; end if;
  insert into public.goal_key_results (goal_id, body, target, unit, position)
  values (p_goal_id, btrim(coalesce(p_body, '')), p_target, coalesce(p_unit, ''),
          coalesce((select max(position) + 1 from public.goal_key_results where goal_id = p_goal_id), 0))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.add_key_result(uuid, text, numeric, text) to authenticated;

create or replace function public.update_key_result(
  p_id uuid, p_body text default null, p_target numeric default null,
  p_current numeric default null, p_unit text default null
)
returns public.goal_key_results language plpgsql security definer set search_path = '' as $$
declare v_row public.goal_key_results;
begin
  if not exists (
    select 1 from public.goal_key_results kr where kr.id = p_id and public.can_edit_goal(kr.goal_id)
  ) then raise exception 'Key result not found or not permitted'; end if;
  update public.goal_key_results kr
     set body = case when p_body is not null then btrim(p_body) else kr.body end,
         target = coalesce(p_target, kr.target),
         current = coalesce(p_current, kr.current),
         unit = coalesce(p_unit, kr.unit)
   where kr.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_key_result(uuid, text, numeric, numeric, text) to authenticated;

create or replace function public.delete_key_result(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.goal_key_results kr where kr.id = p_id and public.can_edit_goal(kr.goal_id)
  ) then raise exception 'Key result not found or not permitted'; end if;
  delete from public.goal_key_results where id = p_id;
end; $$;
grant execute on function public.delete_key_result(uuid) to authenticated;

-- All KRs for a team's goals so the client can map goal → KRs.
create or replace function public.list_goal_key_results(p_team_id uuid)
returns setof public.goal_key_results language sql security definer set search_path = '' as $$
  select kr.* from public.goal_key_results kr
  join public.goals g on g.id = kr.goal_id
  where g.team_id = p_team_id and g.team_id in (select public.get_my_team_ids())
  order by kr.position, kr.created_at;
$$;
grant execute on function public.list_goal_key_results(uuid) to authenticated;

notify pgrst, 'reload schema';
