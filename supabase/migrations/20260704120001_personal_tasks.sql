-- Simple personal task tracker (the sidebar "Tasks" widget).
--
-- A lightweight private checklist per user, scoped to a team so a multi-org
-- member keeps separate lists. Replaces the ClickUp-integration placeholder for
-- now — just add / check off / delete. Own-rows-only RLS; nobody but the owner
-- can read or write their tasks.
--
-- Fresh timestamp (latest applied is 20260703120000); shared DB across branches.

create table if not exists public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  title text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.personal_tasks enable row level security;

-- Own rows only, for every verb.
create policy "personal_tasks_select_own" on public.personal_tasks
  for select using (user_id = auth.uid());
create policy "personal_tasks_insert_own" on public.personal_tasks
  for insert with check (user_id = auth.uid());
create policy "personal_tasks_update_own" on public.personal_tasks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "personal_tasks_delete_own" on public.personal_tasks
  for delete using (user_id = auth.uid());

create index if not exists personal_tasks_user_team_idx
  on public.personal_tasks (user_id, team_id, done, sort_order);

notify pgrst, 'reload schema';
