-- World clock: an admin-curated list of the locations a team operates in
-- (city label + IANA timezone), shown in the office widgets sidebar so everyone
-- can see local time across those places. Org-level config, so it lives on the
-- teams row alongside the other org settings (name, color, office_vibe). Shape:
--   [{ "id": "<uuid>", "label": "New York", "tz": "America/New_York" }, ...]
--
-- No RLS change needed: members already read their team row (the widget reads
-- this column via a SELECT) and the existing admin-only UPDATE policy on teams
-- governs who can edit it.
alter table public.teams
  add column if not exists world_clock_locations jsonb not null default '[]'::jsonb;
