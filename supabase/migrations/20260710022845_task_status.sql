-- Task status tracker: To do → In progress → Done.
--
-- A lightweight kanban-style status on tasks, editable from the shared task
-- editor. `done` stays the source of truth for timeline grouping + gamification
-- + calendar, so status is kept in sync: status='done' ⇔ done=true. The middle
-- 'doing' state is distinct from the `in_progress` focus flag (that's the
-- pomodoro focus, a separate concept).
--
-- Additive/defaulted; existing done tasks are backfilled to 'done'.
-- Fresh timestamp after 20260710120000. Apply via MCP.

alter table public.planner_tasks
  add column if not exists status text not null default 'todo';
alter table public.planner_tasks
  drop constraint if exists planner_tasks_status_check;
alter table public.planner_tasks
  add constraint planner_tasks_status_check check (status in ('todo', 'doing', 'done'));
update public.planner_tasks set status = 'done' where done = true and status <> 'done';

alter table public.personal_tasks
  add column if not exists status text not null default 'todo';
alter table public.personal_tasks
  drop constraint if exists personal_tasks_status_check;
alter table public.personal_tasks
  add constraint personal_tasks_status_check check (status in ('todo', 'doing', 'done'));
update public.personal_tasks set status = 'done' where done = true and status <> 'done';

notify pgrst, 'reload schema';
