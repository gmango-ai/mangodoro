-- Multiple custom pomodoro sounds — per-user and per-team.
--
-- Replaces the legacy single-sound design (user_settings.pomodoro_sound_url)
-- with a JSONB array of user sounds and a team_sounds table for org-wide
-- sounds that any team member can pick.
--
-- The legacy column stays for a release so the client can migrate it into
-- custom_sounds on next save. Don't drop it here.

-- ── Per-user sound list ────────────────────────────────────────────
alter table public.user_settings
  add column if not exists custom_sounds jsonb not null default '[]'::jsonb;

-- ── Team-shared sounds ─────────────────────────────────────────────
create table if not exists public.team_sounds (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  url text not null,
  -- Path inside the pomodoro-sounds bucket (e.g. team/<teamId>/sound-<ts>.mp3).
  -- Stored separately from `url` so we can drop the file when the row is
  -- deleted without re-parsing the public URL.
  path text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists team_sounds_team_id_idx on public.team_sounds (team_id);

alter table public.team_sounds enable row level security;

drop policy if exists "Team members read team_sounds" on public.team_sounds;
create policy "Team members read team_sounds"
  on public.team_sounds for select
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

drop policy if exists "Team admins insert team_sounds" on public.team_sounds;
create policy "Team admins insert team_sounds"
  on public.team_sounds for insert
  with check (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
    and created_by = auth.uid()
  );

drop policy if exists "Team admins update team_sounds" on public.team_sounds;
create policy "Team admins update team_sounds"
  on public.team_sounds for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Team admins delete team_sounds" on public.team_sounds;
create policy "Team admins delete team_sounds"
  on public.team_sounds for delete
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── Storage policies: allow team admins to write team/<teamId>/ ────
-- The original policies only let a user write under their own auth.uid
-- prefix; we add team-admin writes under the literal "team/<teamId>/"
-- path. Public read stays unchanged.

drop policy if exists "pomodoro-sounds: team admins write team prefix" on storage.objects;
create policy "pomodoro-sounds: team admins write team prefix"
  on storage.objects for insert
  with check (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = auth.uid()
        and tm.role = 'admin'
        and tm.team_id::text = (storage.foldername(name))[2]
    )
  );

drop policy if exists "pomodoro-sounds: team admins update team prefix" on storage.objects;
create policy "pomodoro-sounds: team admins update team prefix"
  on storage.objects for update
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = auth.uid()
        and tm.role = 'admin'
        and tm.team_id::text = (storage.foldername(name))[2]
    )
  );

drop policy if exists "pomodoro-sounds: team admins delete team prefix" on storage.objects;
create policy "pomodoro-sounds: team admins delete team prefix"
  on storage.objects for delete
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = auth.uid()
        and tm.role = 'admin'
        and tm.team_id::text = (storage.foldername(name))[2]
    )
  );

notify pgrst, 'reload schema';
