-- Atmosphere setting on the virtual office grid. 'quiet' keeps the
-- /pomodoro tiles static; 'active' adds a subtle pulse on tiles whose
-- session is currently running, for a more "alive" team feel. Admin-only
-- via the existing teams update policy.

alter table public.teams
  add column if not exists office_vibe text
  not null
  default 'quiet'
  check (office_vibe in ('quiet', 'active'));

notify pgrst, 'reload schema';
