-- Pay rate can be entered hourly or yearly. hourly_rate stays the canonical
-- value used for all earnings math; wage_mode is the entry/display preference
-- and annual_salary preserves the exact yearly figure the user typed (the
-- hourly is derived as annual / 2080 = 40h × 52w).
alter table public.user_settings
  add column if not exists wage_mode text not null default 'hourly' check (wage_mode in ('hourly', 'yearly')),
  add column if not exists annual_salary numeric;

notify pgrst, 'reload schema';
