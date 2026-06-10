-- Interstitial countdown between work and break (pending_mode set while counting down)

alter table public.user_pomodoro_state
  add column if not exists pending_mode text null
    check (pending_mode is null or pending_mode in ('work', 'shortBreak', 'longBreak'));

alter table public.sync_sessions
  add column if not exists pending_mode text null
    check (pending_mode is null or pending_mode in ('work', 'shortBreak', 'longBreak'));
