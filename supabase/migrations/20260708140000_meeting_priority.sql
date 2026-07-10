-- Calendar: meetings get a priority so important ones sort above others (and
-- above/below deadlines) in the day cells + agenda. 0=low, 1=normal, 2=high.
alter table public.scheduled_meetings
  add column if not exists priority smallint not null default 1;

notify pgrst, 'reload schema';
