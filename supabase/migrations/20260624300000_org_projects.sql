-- Org projects: a shared, team-scoped list people pick from to say what they're
-- working on — a lightweight stand-in until tasks/ClickUp are connected. Members
-- read the active list; team admins curate it. (Distinct from the per-user
-- `projects` table used for invoicing.)

create table if not exists public.org_projects (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null default '',
  color       text not null default '#14b8a6',
  archived_at timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists org_projects_team_idx on public.org_projects(team_id) where archived_at is null;

alter table public.org_projects replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.org_projects;
exception when duplicate_object then null; end $$;

alter table public.org_projects enable row level security;

drop policy if exists "team reads org_projects" on public.org_projects;
create policy "team reads org_projects" on public.org_projects
  for select using (team_id in (select public.get_my_team_ids()));

drop policy if exists "admins write org_projects" on public.org_projects;
create policy "admins write org_projects" on public.org_projects
  for all
  using (team_id in (select public.get_my_admin_team_ids()))
  with check (team_id in (select public.get_my_admin_team_ids()));

notify pgrst, 'reload schema';
