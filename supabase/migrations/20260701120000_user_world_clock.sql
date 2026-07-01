-- Personal world clock + pinned nav time, per user.
--
-- The org's operating locations live on teams.world_clock_locations (shared,
-- admin-curated). These two columns are PERSONAL to each user:
--   world_clock_personal — jsonb array of { id, label, tz } (IANA zone) the user
--                          adds for their own world-clock dropdown.
--   nav_pinned_tz        — an IANA zone the user pinned so the nav shows its
--                          live local time at a glance.
--
-- Both are covered by the existing user_settings RLS (a user reads/writes only
-- their own row); no new policy needed. `select *` in AppContext picks them up
-- automatically, and worldClock.js reads teams separately, so an unapplied
-- migration only degrades these fields, never the whole settings load.

alter table public.user_settings
  add column if not exists world_clock_personal jsonb not null default '[]'::jsonb,
  add column if not exists nav_pinned_tz text;
