-- Calendar work-location conflict resolution: a per-date override map so that when
-- the app work_schedule location and Google's working-location disagree for a day,
-- the user's pick sticks. Keys are 'YYYY-MM-DD', values a location label/code.
alter table public.user_settings
  add column if not exists work_location_overrides jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
