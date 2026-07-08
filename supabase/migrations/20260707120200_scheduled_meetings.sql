-- Meetings — Phase 1c: scheduled_meetings.
--
-- A meeting booked into a room, optionally mirrored to the creator's Google
-- Calendar (the event is created client-side with the foreground Google token;
-- the returned id/link are stored here). No secret is involved, so the client
-- inserts the row directly — RLS keeps it to the creator + their team.

create table public.scheduled_meetings (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms(id) on delete cascade,
  team_id            uuid not null references public.teams(id) on delete cascade,
  created_by         uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  description        text,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  attendee_ids       uuid[] not null default '{}',
  attendee_emails    text[] not null default '{}',
  auto_record        boolean not null default false,
  google_event_id    text,
  google_calendar_id text default 'primary',
  google_html_link   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index scheduled_meetings_team_upcoming
  on public.scheduled_meetings (team_id, starts_at);
create index scheduled_meetings_room
  on public.scheduled_meetings (room_id, starts_at);

alter table public.scheduled_meetings enable row level security;

create policy "scheduled_meetings: team reads"
  on public.scheduled_meetings for select
  using (public.is_team_member(team_id));

create policy "scheduled_meetings: member creates"
  on public.scheduled_meetings for insert
  with check (created_by = auth.uid() and public.is_team_member(team_id));

create policy "scheduled_meetings: creator or admin edits"
  on public.scheduled_meetings for update
  using (created_by = auth.uid() or public.is_org_admin(team_id))
  with check (created_by = auth.uid() or public.is_org_admin(team_id));

create policy "scheduled_meetings: creator or admin deletes"
  on public.scheduled_meetings for delete
  using (created_by = auth.uid() or public.is_org_admin(team_id));

notify pgrst, 'reload schema';
