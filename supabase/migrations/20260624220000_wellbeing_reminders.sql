-- Wellbeing / break reminders: configurable recurring self-nudges (hydration,
-- move, eye rest, posture, stretch, breathe…) that fire during the user's
-- active hours and ride the notification layer (inbox + desktop). Per-reminder
-- config lives in a JSONB on user_settings; all of them share one `reminder`
-- notification type (the per-reminder enable/interval is the real control).

alter table public.user_settings
  add column if not exists wellbeing_reminders jsonb not null default '{}'::jsonb,
  add column if not exists reminder_active_start time,
  add column if not exists reminder_active_end time;

-- `reminder` defaults to inapp + desktop.
create or replace function public.notif_type_default_channels(p_type text)
returns text[] language sql immutable as $$
  select case p_type
    when 'room_joined'    then array['inapp']
    when 'lunch_return'   then array['inapp']
    when 'lunch_start'    then array['inapp']
    when 'lunch_reminder' then array['inapp', 'desktop']
    when 'reminder'       then array['inapp', 'desktop']
    else array['inapp', 'desktop']
  end;
$$;

-- Allow the client to self-emit the shared `reminder` type.
create or replace function public.emit_self_notification(
  p_type text, p_title text, p_body text default null, p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null, p_dedupe_window_minutes int default 60
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_type not in ('lunch_reminder', 'reminder_daily', 'reminder') then
    raise exception 'Not a self-notifiable type';
  end if;
  return public.emit_notification(
    auth.uid(), p_type, p_title, p_body, coalesce(p_payload, '{}'::jsonb),
    null, null, null, null, p_dedupe_key, p_dedupe_window_minutes);
end; $$;

notify pgrst, 'reload schema';
