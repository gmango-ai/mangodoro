-- Company events surfaced from a user's Google Calendar and confirmed for the
-- whole team. Company events live MIXED into each person's personal Google
-- calendar, so a heuristic (someone on the company email domain is involved)
-- SUGGESTS candidates; the user confirms which get shared here. Deduped on
-- (team_id, ical_uid) — iCalUID is stable across every attendee's calendar copy,
-- so the same meeting confirmed by several teammates collapses to one row.
--
-- No secret is involved; the client upserts directly. RLS keeps reads to the
-- team, upserts to members (stamped with their own id), deletes to the publisher
-- or a team admin — mirroring scheduled_meetings.

create table public.google_company_events (
  team_id         uuid not null references public.teams(id) on delete cascade,
  ical_uid        text not null,
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,
  location        text,
  html_link       text,
  organizer_email text,
  google_event_id text,
  payload         jsonb,
  published_by    uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (team_id, ical_uid)
);

create index google_company_events_team_range
  on public.google_company_events (team_id, starts_at);

alter table public.google_company_events enable row level security;

create policy "gce: team reads"
  on public.google_company_events for select
  using (public.is_team_member(team_id));

create policy "gce: member upserts"
  on public.google_company_events for insert
  with check (published_by = auth.uid() and public.is_team_member(team_id));

-- Any team member may refresh/re-publish a shared company event (so a second
-- teammate publishing the same meeting updates the one row); the new row is
-- stamped with the updater's id.
create policy "gce: member updates"
  on public.google_company_events for update
  using (public.is_team_member(team_id))
  with check (published_by = auth.uid() and public.is_team_member(team_id));

create policy "gce: publisher or admin deletes"
  on public.google_company_events for delete
  using (published_by = auth.uid() or public.is_org_admin(team_id));

notify pgrst, 'reload schema';
