-- Meetings — Phase 1a: the meeting_recordings table.
--
-- One row per "record this call" toggle. Written exclusively by the service role
-- (start-egress / egress-webhook / process-recording edge functions); the client
-- only reads it (and subscribes via Realtime so every participant sees the REC
-- indicator flip). Read is scoped to members of the room's team.
--
-- Design notes:
--   • room_id is `on delete set null` so a summary survives the room's deletion.
--   • session_id has NO FK: end_sync_session hard-deletes the sync_sessions row
--     (and cascades its participants), so by the time the egress webhook fires
--     the session is gone. participant_ids is a SNAPSHOT taken at start time —
--     that's who we notify when the summary is ready.

-- Reusable "is the current user a member of this org/team?" check. team_members
-- rows are the org membership (teams.id == the org). SECURITY DEFINER so RLS
-- policies can call it without recursing into team_members' own policies.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_team_member(uuid) to authenticated;

create table public.meeting_recordings (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid references public.rooms(id) on delete set null,
  team_id          uuid not null references public.teams(id) on delete cascade,
  session_id       uuid,               -- sync_sessions.id at start (no FK — session is hard-deleted on end)
  livekit_room     text not null,      -- mangodoro-{roomId}
  egress_id        text,               -- LiveKit egress id; correlation key for the webhook + StopEgress
  started_by       uuid references auth.users(id) on delete set null,
  participant_ids  uuid[] not null default '{}',  -- SNAPSHOT at start (who to notify when ready)
  status           text not null default 'starting'
                     check (status in ('starting','recording','processing','ready','failed','stopped')),
  storage_path     text,               -- meeting-recordings/{roomId}/{recordingId}/audio.ogg
  duration_seconds int,
  file_bytes       bigint,
  error            text,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);

-- Fast lookup of a room's in-flight recording (the one-active-per-room guard +
-- the in-call indicator).
create index meeting_recordings_room_active
  on public.meeting_recordings (room_id)
  where status in ('starting','recording');

-- The review page lists a team's recordings newest-first.
create index meeting_recordings_team_recent
  on public.meeting_recordings (team_id, started_at desc);

-- Realtime: push the REC indicator (and status transitions) to all participants.
alter table public.meeting_recordings replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.meeting_recordings;
exception when duplicate_object then null; end $$;

alter table public.meeting_recordings enable row level security;

-- Read: any member of the room's team.
create policy "meeting_recordings: team reads"
  on public.meeting_recordings for select
  using (public.is_team_member(team_id));

-- Delete: the person who started it, or an org admin (retention / mistakes).
-- The app removes the storage object alongside the row. No client INSERT/UPDATE
-- — the pipeline writes with the service role.
create policy "meeting_recordings: starter or admin deletes"
  on public.meeting_recordings for delete
  using (started_by = auth.uid() or public.is_org_admin(team_id));

notify pgrst, 'reload schema';
