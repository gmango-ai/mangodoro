-- Allow the 'retro' whiteboard template (frames for Celebrate / Went well
-- / To improve / Action items). Keeps TEMPLATES in lockstep with the SQL
-- check constraint on whiteboards.template_key.

alter table public.whiteboards drop constraint if exists whiteboards_template_check;
alter table public.whiteboards
  add constraint whiteboards_template_check
  check (template_key in ('blank', 'weekly_review', 'brainstorm', 'retro'));
