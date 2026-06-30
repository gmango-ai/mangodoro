-- Channel preference rows should not mark a conversation as read.
alter table public.channel_read_state
  alter column last_read_at set default 'epoch'::timestamptz;

notify pgrst, 'reload schema';
