-- Focus notes — the per-focus-block reflections captured by the "What did you
-- work on?" prompt, kept as a durable, queryable journal with their optional
-- Result status (in_progress / done / blocked). Previously a reflection's status
-- only survived as a "— Done" suffix folded into the day's time-entry
-- description, so there was no way to browse past notes-with-status on a profile.
-- Each saved reflection now also lands here.
create table if not exists public.focus_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  text text not null,
  status text check (status is null or status in ('in_progress', 'done', 'blocked')),
  created_at timestamptz not null default now()
);

-- Profile view reads a user's own recent notes newest-first.
create index if not exists focus_notes_user_created_idx
  on public.focus_notes (user_id, created_at desc);

alter table public.focus_notes enable row level security;

-- Personal reflections: own rows only (the profile section is self-only).
create policy "focus_notes_select_own" on public.focus_notes
  for select using (user_id = auth.uid());
create policy "focus_notes_insert_own" on public.focus_notes
  for insert with check (user_id = auth.uid());
create policy "focus_notes_delete_own" on public.focus_notes
  for delete using (user_id = auth.uid());
