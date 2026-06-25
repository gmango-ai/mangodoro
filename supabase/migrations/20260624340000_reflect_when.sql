-- When to prompt for a "what did you work on?" reflection around pomodoro
-- phases: off | after_focus (focus → break) | before_focus (break → next focus)
-- | both. Personal pref (not mirrored to profiles).
alter table public.user_settings
  add column if not exists reflect_when text not null default 'off'
    check (reflect_when in ('off', 'after_focus', 'before_focus', 'both'));

notify pgrst, 'reload schema';
