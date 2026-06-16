-- Persistent per-room chat. Messages attach to the room (not the
-- sync_session) so history survives session resets and the room
-- itself behaves like a Slack channel. Soft-delete via `deleted_at`
-- so realtime UPDATE events propagate the redaction without needing
-- a parallel DELETE handler on the client.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

-- Hot path: recent messages for a room, newest first, hiding tombstones.
create index if not exists chat_messages_room_recent
  on public.chat_messages (room_id, created_at desc)
  where deleted_at is null;

alter table public.chat_messages replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

-- RLS
alter table public.chat_messages enable row level security;

drop policy if exists "Team members can read room chat" on public.chat_messages;
create policy "Team members can read room chat"
  on public.chat_messages for select
  using (
    room_id in (
      select r.id
      from public.rooms r
      where r.team_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

drop policy if exists "Team members can send room chat" on public.chat_messages;
create policy "Team members can send room chat"
  on public.chat_messages for insert
  with check (
    user_id = auth.uid()
    and room_id in (
      select r.id
      from public.rooms r
      where r.team_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

-- Edit / soft-delete: authors only. (Moderation by admins lands in a
-- follow-up RPC if/when we need it; deferring to keep the policy set
-- tight.)
drop policy if exists "Authors can update their own messages" on public.chat_messages;
create policy "Authors can update their own messages"
  on public.chat_messages for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
