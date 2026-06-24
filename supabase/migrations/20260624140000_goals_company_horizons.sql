-- Goals expansion, Stage A: a company/org goal level + time horizons.
--
-- owner_type gains 'company' (owner_id = the team/org id) so there's a
-- top-of-tree goal above departments + people. `horizon` gives a goal a
-- timeframe (this week / month / quarter / year) — e.g. "this month's company
-- goal" — and a basis for history/grouping later.

alter table public.goals drop constraint if exists goals_owner_type_check;
alter table public.goals
  add constraint goals_owner_type_check check (owner_type in ('company', 'department', 'user'));

alter table public.goals
  add column if not exists horizon text not null default 'none'
    check (horizon in ('none', 'week', 'month', 'quarter', 'year'));

-- create_goal gains p_horizon (drop+recreate to change the signature).
drop function if exists public.create_goal(uuid, text, uuid, text, text, text);
create or replace function public.create_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text, p_horizon text default 'none'
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not (p_team_id in (select public.get_my_team_ids())) then
    raise exception 'Not a member of this team';
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, horizon, set_by, set_at, position)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(coalesce(p_body, '')),
          coalesce(nullif(p_horizon, ''), 'none'), auth.uid(), now(),
          coalesce((select max(position) + 1 from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id), 0))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_goal(uuid, text, uuid, text, text, text, text) to authenticated;

-- update_goal gains p_horizon (prior signature added p_is_public in 130000).
drop function if exists public.update_goal(uuid, text, text, boolean);
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null,
  p_is_public boolean default null, p_horizon text default null
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
  update public.goals g
     set body = case when p_body is not null then btrim(p_body) else g.body end,
         status = coalesce(p_status, g.status),
         is_public = coalesce(p_is_public, g.is_public),
         horizon = coalesce(p_horizon, g.horizon),
         completed_at = case when p_status = 'done' then now()
                             when p_status = 'active' then null
                             else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
