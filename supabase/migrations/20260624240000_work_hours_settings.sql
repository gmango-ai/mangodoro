-- Working-hours + paid-lunch settings (presence/time-tracking phase 0).
--   work_start / work_end  → a person's typical hours; drives the hover-card
--     "almost offline" badge + availability, and the wellbeing-reminder active
--     window can default from these (one source of truth).
--   lunch_break_paid       → whether the quick "On lunch" break counts as paid
--     (default false = unpaid, the common case).
alter table public.user_settings
  add column if not exists work_start time,
  add column if not exists work_end time,
  add column if not exists lunch_break_paid boolean not null default false;

notify pgrst, 'reload schema';
