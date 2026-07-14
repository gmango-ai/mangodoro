-- Subtasks for BOTH task systems (planner_tasks + personal_tasks) in one table,
-- via two nullable FKs so cascade deletes are real and there are no orphans.
-- Exactly one parent per row.
create table if not exists public.task_subtasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planner_task_id  uuid references public.planner_tasks(id) on delete cascade,
  personal_task_id uuid references public.personal_tasks(id) on delete cascade,
  title            text not null,
  done             boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  constraint task_subtasks_one_parent check (num_nonnulls(planner_task_id, personal_task_id) = 1)
);

create index if not exists task_subtasks_planner_idx  on public.task_subtasks (planner_task_id, sort_order)  where planner_task_id is not null;
create index if not exists task_subtasks_personal_idx on public.task_subtasks (personal_task_id, sort_order) where personal_task_id is not null;

alter table public.task_subtasks enable row level security;

-- Own rows only, for every verb (mirrors personal_tasks).
create policy "task_subtasks_select_own" on public.task_subtasks
  for select using (user_id = auth.uid());
create policy "task_subtasks_insert_own" on public.task_subtasks
  for insert with check (user_id = auth.uid());
create policy "task_subtasks_update_own" on public.task_subtasks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "task_subtasks_delete_own" on public.task_subtasks
  for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';
