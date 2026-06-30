-- Messaging v2 — Phase 7: message attachments.
--
-- Files live in the `message-attachments` Storage bucket (created out-of-band /
-- via the dashboard; the client uploads with the avatar.js pattern). This table
-- records one row per attached file, joined to its message. Read access follows
-- the message's conversation; inserts are gated to the message's sender.

create table if not exists public.dm_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.dm_messages(id) on delete cascade,
  storage_path text not null,
  url          text not null,
  mime         text,
  bytes        integer,
  width        integer,
  height       integer,
  created_at   timestamptz not null default now()
);
create index if not exists dm_message_attachments_msg_idx on public.dm_message_attachments (message_id);

alter table public.dm_message_attachments replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.dm_message_attachments;
exception when duplicate_object then null; end $$;

alter table public.dm_message_attachments enable row level security;

-- message_conversation_id() + can_access_conversation() come from earlier phases.
drop policy if exists "member reads attachments" on public.dm_message_attachments;
create policy "member reads attachments" on public.dm_message_attachments
  for select using (public.can_access_conversation(public.message_conversation_id(message_id)));

drop policy if exists "sender adds attachment" on public.dm_message_attachments;
create policy "sender adds attachment" on public.dm_message_attachments
  for insert with check (
    exists (
      select 1 from public.dm_messages m
       where m.id = message_id and m.sender_id = auth.uid()
    )
  );

drop policy if exists "sender removes attachment" on public.dm_message_attachments;
create policy "sender removes attachment" on public.dm_message_attachments
  for delete using (
    exists (
      select 1 from public.dm_messages m
       where m.id = message_id and m.sender_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
