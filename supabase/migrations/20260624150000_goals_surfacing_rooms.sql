-- Goals expansion, Stage B: surfacing (pin vs background) + per-room scoping.
--
-- `pinned` controls whether a goal surfaces on the office / pomodoro displays
-- (unpinned = kept in the background, still managed). `goal_rooms` optionally
-- scopes a goal to specific office rooms — a goal with NO room rows is global
-- (shows everywhere); with rows, it only surfaces in those rooms.

alter table public.goals
  add column if not exists pinned boolean not null default true;

create table if not exists public.goal_rooms (
  goal_id uuid not null references public.goals(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  primary key (goal_id, room_id)
);
alter table public.goal_rooms enable row level security;

-- Team members can read room scoping for goals in their team. Writes go
-- through set_goal_rooms (security definer) — no direct client writes.
drop policy if exists "Team members read goal_rooms" on public.goal_rooms;
create policy "Team members read goal_rooms" on public.goal_rooms
  for select using (
    goal_id in (select id from public.goals where team_id in (select public.get_my_team_ids()))
  );

-- update_goal gains p_pinned (drop+recreate to change the signature).
drop function if exists public.update_goal(uuid, text, text, boolean, text);
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null,
  p_is_public boolean default null, p_horizon text default null, p_pinned boolean default null
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
         pinned = coalesce(p_pinned, g.pinned),
         completed_at = case when p_status = 'done' then now()
                             when p_status = 'active' then null
                             else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text, boolean, text, boolean) to authenticated;

-- Replace a goal's room scoping with the given set (empty array = global).
create or replace function public.set_goal_rooms(p_goal_id uuid, p_room_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.goals g where g.id = p_goal_id and g.team_id in (select public.get_my_team_ids())) then
    raise exception 'Goal not found or not permitted';
  end if;
  delete from public.goal_rooms where goal_id = p_goal_id;
  insert into public.goal_rooms (goal_id, room_id)
    select p_goal_id, r from unnest(coalesce(p_room_ids, '{}'::uuid[])) as r
    where r in (select id from public.rooms where team_id in (select public.get_my_team_ids()));
end; $$;
grant execute on function public.set_goal_rooms(uuid, uuid[]) to authenticated;

-- List (goal_id, room_id) pairs for a team's goals so the client can map
-- each goal to its scoped rooms.
create or replace function public.list_goal_rooms(p_team_id uuid)
returns table(goal_id uuid, room_id uuid) language sql security definer set search_path = '' as $$
  select gr.goal_id, gr.room_id
  from public.goal_rooms gr
  join public.goals g on g.id = gr.goal_id
  where g.team_id = p_team_id and g.team_id in (select public.get_my_team_ids());
$$;
grant execute on function public.list_goal_rooms(uuid) to authenticated;

notify pgrst, 'reload schema';
