-- Per-user accent color choice.
--
-- Stored as a short slug (e.g. "teal", "violet", "amber") rather than
-- a hex code so the UI can map each slug to a curated palette of
-- light/dark/hover variants. A free hex picker would be possible too
-- but harder to guarantee readable contrast across every surface, so
-- we keep the surface area constrained to ~10 vetted options.
--
-- Default 'teal' matches the existing --color-accent so users who
-- never visit Settings see no change.

alter table public.user_settings
  add column if not exists accent_color text not null default 'teal';

notify pgrst, 'reload schema';
