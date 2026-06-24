-- Carry @mention targets on chat messages so the client can render @Name as a
-- link to the person's profile (and so a future server-side mention trigger
-- could fan out without parsing body text).

alter table public.chat_messages
  add column if not exists mentioned_user_ids uuid[] not null default '{}';

notify pgrst, 'reload schema';
