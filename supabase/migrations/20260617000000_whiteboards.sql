-- Whiteboards: a tldraw-backed collaborative canvas per team. Replaces
-- the bespoke /retros board with a templated whiteboard surface; retros
-- live alongside for archive viewing until we migrate them in.
--
-- The whole canvas state (shapes, frames, sticky notes, drawings) is
-- stored as a single tldraw snapshot in `snapshot` (jsonb). We persist
-- via debounced upserts from the client; realtime fanout is via
-- supabase_realtime on the whiteboards table itself, which gives every
-- subscriber a `postgres_changes` event with the new snapshot. Truly
-- low-latency multiplayer (per-cursor + per-operation diffs) is a Phase
-- 2 concern — for now we ship last-write-wins because it covers the
-- "asynchronous retro / planning board" use case without a sync server.

create table if not exists public.whiteboards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null default 'Untitled whiteboard',
  -- The template the board was originally seeded with. Templates can
  -- pre-populate the snapshot with frames, sticky notes, and a goal
  -- banner. Stored so the UI can show a small badge and so we can
  -- evolve template content later without touching existing boards.
  template_key text not null default 'blank',
  goal text not null default '',
  snapshot jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint whiteboards_template_check
    check (template_key in ('blank', 'weekly_review', 'brainstorm'))
);

create index if not exists whiteboards_team_recent_idx
  on public.whiteboards (team_id, created_at desc);

-- Realtime: same shape as retros / chat — we want other tabs / users to
-- pick up snapshot updates without an extra channel layer.
alter table public.whiteboards replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.whiteboards;
exception when duplicate_object then null;
end $$;

-- ─── RLS ────────────────────────────────────────────────────────────
-- Reuse the security-definer helper functions added in
-- 20260519140000_fix_rls_recursion.sql so policies don't recurse
-- through team_members.

alter table public.whiteboards enable row level security;

drop policy if exists "Team members can read whiteboards" on public.whiteboards;
create policy "Team members can read whiteboards"
  on public.whiteboards for select
  using (team_id in (select public.get_my_team_ids()));

drop policy if exists "Team members can create whiteboards" on public.whiteboards;
create policy "Team members can create whiteboards"
  on public.whiteboards for insert
  with check (
    created_by = auth.uid()
    and team_id in (select public.get_my_team_ids())
  );

-- Any team member can edit the board content (snapshot, title, goal).
-- We don't enforce per-shape ownership — that's a property of the
-- snapshot, not the row. RLS just gates access to the team's board.
drop policy if exists "Team members can update whiteboards" on public.whiteboards;
create policy "Team members can update whiteboards"
  on public.whiteboards for update
  using (team_id in (select public.get_my_team_ids()))
  with check (team_id in (select public.get_my_team_ids()));

-- Hard delete is admin-only. The product surface uses archived_at +
-- update for the everyday "delete" button — matches how retros work.
drop policy if exists "Admins can delete whiteboards" on public.whiteboards;
create policy "Admins can delete whiteboards"
  on public.whiteboards for delete
  using (team_id in (select public.get_my_admin_team_ids()));

-- Bump updated_at on every write so the list view can sort by activity
-- without us threading the timestamp through every client mutation.
create or replace function public.tg_whiteboards_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_whiteboards_touch on public.whiteboards;
create trigger tr_whiteboards_touch
  before update on public.whiteboards
  for each row execute function public.tg_whiteboards_touch();

notify pgrst, 'reload schema';
