-- Per-team flag controlling whether sound uploads are restricted to
-- team admins or open to any team member. Default true keeps the
-- previous behavior (admin-only) for every existing team.

alter table public.teams
  add column if not exists sounds_admin_only boolean not null default true;

-- Replace the admin-only insert/update/delete policies for team_sounds
-- so members can also write when sounds_admin_only is false. Delete and
-- update are scoped to the row's creator OR any team admin so a regular
-- member can manage their own uploads without seeing everyone else's.

drop policy if exists "Team admins insert team_sounds" on public.team_sounds;
create policy "Members or admins insert team_sounds"
  on public.team_sounds for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.team_id = team_sounds.team_id
        and tm.user_id = auth.uid()
        and (tm.role = 'admin' or t.sounds_admin_only = false)
    )
  );

drop policy if exists "Team admins update team_sounds" on public.team_sounds;
create policy "Owner or admin update team_sounds"
  on public.team_sounds for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and (role = 'admin' or created_by = auth.uid())
    )
  );

drop policy if exists "Team admins delete team_sounds" on public.team_sounds;
create policy "Owner or admin delete team_sounds"
  on public.team_sounds for delete
  using (
    created_by = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Storage policies for team/<teamId>/ prefix — match the row-level
-- behavior. Admins can always write; members can write only when the
-- team's sounds_admin_only flag is false.

drop policy if exists "pomodoro-sounds: team admins write team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins write team prefix"
  on storage.objects for insert
  with check (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.user_id = auth.uid()
        and tm.team_id::text = (storage.foldername(name))[2]
        and (tm.role = 'admin' or t.sounds_admin_only = false)
    )
  );

drop policy if exists "pomodoro-sounds: team admins update team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins update team prefix"
  on storage.objects for update
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.user_id = auth.uid()
        and tm.team_id::text = (storage.foldername(name))[2]
        and (tm.role = 'admin' or t.sounds_admin_only = false)
    )
  );

drop policy if exists "pomodoro-sounds: team admins delete team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins delete team prefix"
  on storage.objects for delete
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and exists (
      select 1
      from public.team_members tm
      where tm.user_id = auth.uid()
        and tm.team_id::text = (storage.foldername(name))[2]
        -- For deletes, admins can wipe; members may only delete their own
        -- (owner=auth.uid()). RLS on team_sounds row enforces that — the
        -- bucket allows the storage call so the row delete happens first
        -- and the storage object delete follows. Members trying to delete
        -- a non-owned file will fail at the team_sounds RLS first.
        and (
          tm.role = 'admin'
          or exists (
            select 1 from public.team_sounds ts
            where ts.path = name
              and ts.team_id = tm.team_id
              and ts.created_by = auth.uid()
          )
        )
    )
  );

notify pgrst, 'reload schema';
