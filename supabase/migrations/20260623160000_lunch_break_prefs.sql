-- Lunch-break preference: a default lunch time + what to do when it arrives.
--
-- lunch_mode: 'off' (nothing), 'ask' (prompt the user), 'auto' (flip status to
-- out_to_lunch automatically). lunch_duration_min is how long lunch lasts
-- before the status flips back. Written via the normal own-row update path
-- (same as the other user_settings prefs), so no RPC is needed.

alter table public.user_settings
  add column if not exists lunch_time text,
  add column if not exists lunch_mode text not null default 'off'
    check (lunch_mode in ('off', 'ask', 'auto')),
  add column if not exists lunch_duration_min integer not null default 60;

notify pgrst, 'reload schema';
