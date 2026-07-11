-- Task deadline (soft/hard) + labels — powers the Tasks Timeline overview and
-- the shared "syncs everywhere" task editor.
--
-- The timeline groups tasks by due_date and needs two fields the schema lacks:
--   • deadline — 'soft' (a gentle target) vs 'hard' (a real, reminded deadline),
--     surfaced as the coral alarm chip on the line.
--   • labels   — a small set of colored tags (design/research/writing/bug/admin…)
--     chosen client-side; stored as a text[] so no join/table is needed.
-- planner_tasks also gains focus_sessions (count of completed pomodoro focus
-- sessions logged against the task — the design's session dots).
--
-- Both task systems (planner_tasks + personal_tasks) get deadline+labels so the
-- one shared editor is uniform across kinds. All columns are additive and
-- defaulted, so every other branch's code keeps working untouched.
--
-- Fresh timestamp (latest applied is 20260709240000); shared DB across branches —
-- never reuse a version (db push silently skips collisions). Apply via MCP.

-- ── planner_tasks ─────────────────────────────────────────────────────────
alter table public.planner_tasks
  add column if not exists deadline text not null default 'soft';
alter table public.planner_tasks
  drop constraint if exists planner_tasks_deadline_check;
alter table public.planner_tasks
  add constraint planner_tasks_deadline_check check (deadline in ('soft', 'hard'));
alter table public.planner_tasks
  add column if not exists labels text[] not null default '{}';
alter table public.planner_tasks
  add column if not exists focus_sessions int not null default 0;

-- ── personal_tasks ────────────────────────────────────────────────────────
alter table public.personal_tasks
  add column if not exists deadline text not null default 'soft';
alter table public.personal_tasks
  drop constraint if exists personal_tasks_deadline_check;
alter table public.personal_tasks
  add constraint personal_tasks_deadline_check check (deadline in ('soft', 'hard'));
alter table public.personal_tasks
  add column if not exists labels text[] not null default '{}';

notify pgrst, 'reload schema';
