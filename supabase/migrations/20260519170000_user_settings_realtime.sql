-- Enable Realtime on user_settings for instant cross-device clock sync.
-- Replaces the 10-second polling interval with push-based updates.

alter table public.user_settings replica identity full;
alter publication supabase_realtime add table public.user_settings;
