-- Archive tasks: hide them from normal views without deleting.
--
-- `archived` is orthogonal to `done`/`status` — you can archive an unfinished
-- task to declutter, or archive completed ones to file them away. The Tasks
-- overview filters to Active (not archived, not done) / Completed (done) /
-- Archived. Additive/defaulted → safe for other branches.
--
-- Fresh timestamp after 20260710130000. Apply via MCP.

alter table public.planner_tasks
  add column if not exists archived boolean not null default false;
alter table public.personal_tasks
  add column if not exists archived boolean not null default false;

notify pgrst, 'reload schema';
