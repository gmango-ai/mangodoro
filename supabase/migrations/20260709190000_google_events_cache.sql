-- Google Calendar events cache.
--
-- Google events are fetched live from the API and merged into the calendar, but
-- never persisted — so when the OAuth token desyncs (which happens often) every
-- Google event vanishes from the view. This table keeps the last-fetched events
-- per user so they can be shown as a fallback while disconnected. It's a cache,
-- not a source of truth: each successful fetch of a window replaces that
-- window's rows, and a live connection always takes precedence.
create table if not exists public.google_events_cache (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  event_id text not null,
  payload jsonb not null,          -- the normalised event (see listGoogleCalendarEvents)
  start_at timestamptz,
  end_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- Fallback reads pull a user's cached events by start time within a window.
create index if not exists google_events_cache_user_start_idx
  on public.google_events_cache (user_id, start_at);

alter table public.google_events_cache enable row level security;

-- Own-rows only — a private per-user cache.
create policy "gec_select_own" on public.google_events_cache
  for select using (user_id = auth.uid());
create policy "gec_insert_own" on public.google_events_cache
  for insert with check (user_id = auth.uid());
create policy "gec_update_own" on public.google_events_cache
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "gec_delete_own" on public.google_events_cache
  for delete using (user_id = auth.uid());
