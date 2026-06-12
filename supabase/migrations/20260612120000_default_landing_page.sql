-- Per-user preference for which page `/` redirects to. Pomodoro is the
-- new default for everyone (the team's primary use case has shifted from
-- time-tracking to coordinated focus sessions); users who still live in
-- the time tracker can flip it back to 'log' in Settings.

alter table public.user_settings
  add column if not exists default_landing_page text
  not null
  default 'pomodoro'
  check (default_landing_page in ('pomodoro', 'log'));

notify pgrst, 'reload schema';
