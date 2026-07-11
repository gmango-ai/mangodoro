-- Calendar Phase 2: task scheduling fields + milestones.
--
-- planner_tasks gains a due-date + optional time-block (start_time/duration_min)
-- so tasks can be all-day OR time-blocked on the calendar grid. personal_tasks
-- gets an optional due-date so checklist items can carry a deadline. milestones
-- is a new first-class "deadline / big date" entity (personal or team-shared).

alter table public.planner_tasks
  add column if not exists due_date date,
  add column if not exists start_time time,
  add column if not exists duration_min int;

alter table public.personal_tasks
  add column if not exists due_date date;

create table if not exists public.milestones (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  description   text,
  milestone_date date not null,
  milestone_time time,                 -- null = all-day
  color         text,
  scope         text not null default 'personal' check (scope in ('personal','team')),
  link_type     text check (link_type is null or link_type in ('goal','room','meeting')),
  link_id       uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists milestones_team_date on public.milestones (team_id, milestone_date);
create index if not exists milestones_creator on public.milestones (created_by, milestone_date);

alter table public.milestones enable row level security;

-- Read: creator always; team-scoped ones to any member of the team.
create policy "milestones: read" on public.milestones for select
  using (created_by = auth.uid() or (scope = 'team' and public.is_team_member(team_id)));
create policy "milestones: insert" on public.milestones for insert
  with check (created_by = auth.uid() and public.is_team_member(team_id));
create policy "milestones: update" on public.milestones for update
  using (created_by = auth.uid() or public.is_org_admin(team_id))
  with check (created_by = auth.uid() or public.is_org_admin(team_id));
create policy "milestones: delete" on public.milestones for delete
  using (created_by = auth.uid() or public.is_org_admin(team_id));

notify pgrst, 'reload schema';
