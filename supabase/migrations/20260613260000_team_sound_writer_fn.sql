-- Tighten the team-prefix storage policies by wrapping the
-- "can this user write a sound for team X" check in a SECURITY DEFINER
-- helper. The previous version inlined a join over team_members + teams
-- inside the policy; that join runs as the calling user and is subject to
-- the recursive team_members SELECT policy from the original migration,
-- which causes the EXISTS to come up empty in storage's RLS context even
-- for legitimate admins. The helper sidesteps that by running as the
-- migration owner.

create or replace function public.can_write_team_sound(p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_admin_only boolean;
begin
  if p_team_id is null or auth.uid() is null then
    return false;
  end if;
  select role into v_role
    from public.team_members
   where team_id = p_team_id
     and user_id = auth.uid()
   limit 1;
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;
  select sounds_admin_only into v_admin_only
    from public.teams
   where id = p_team_id
   limit 1;
  return coalesce(v_admin_only, true) = false;
end;
$$;

grant execute on function public.can_write_team_sound(uuid) to authenticated;

-- Replace the storage policies to use the helper. Names are kept stable so
-- they still match what shipped in the previous migration.

drop policy if exists "pomodoro-sounds: members or admins write team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins write team prefix"
  on storage.objects for insert
  with check (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and (storage.foldername(name))[2] is not null
    and public.can_write_team_sound(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "pomodoro-sounds: members or admins update team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins update team prefix"
  on storage.objects for update
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and (storage.foldername(name))[2] is not null
    and public.can_write_team_sound(((storage.foldername(name))[2])::uuid)
  );

-- Delete continues to allow team admins OR the storage object's owner, but
-- via the same helper for the admin path. Owner-only deletes for non-admin
-- members fall through to the team_sounds row-level enforcement.

drop policy if exists "pomodoro-sounds: members or admins delete team prefix" on storage.objects;
create policy "pomodoro-sounds: members or admins delete team prefix"
  on storage.objects for delete
  using (
    bucket_id = 'pomodoro-sounds'
    and (storage.foldername(name))[1] = 'team'
    and (storage.foldername(name))[2] is not null
    and (
      public.can_write_team_sound(((storage.foldername(name))[2])::uuid)
      or owner = auth.uid()
    )
  );

-- Same treatment for the team_sounds row policies so an admin's INSERT
-- isn't blocked by a subtle interaction with the recursive team_members
-- SELECT policy when the EXISTS runs as the caller.

drop policy if exists "Members or admins insert team_sounds" on public.team_sounds;
create policy "Members or admins insert team_sounds"
  on public.team_sounds for insert
  with check (
    created_by = auth.uid()
    and public.can_write_team_sound(team_id)
  );

drop policy if exists "Owner or admin update team_sounds" on public.team_sounds;
create policy "Owner or admin update team_sounds"
  on public.team_sounds for update
  using (
    created_by = auth.uid()
    or public.can_write_team_sound(team_id)
  );

drop policy if exists "Owner or admin delete team_sounds" on public.team_sounds;
create policy "Owner or admin delete team_sounds"
  on public.team_sounds for delete
  using (
    created_by = auth.uid()
    or public.can_write_team_sound(team_id)
  );

notify pgrst, 'reload schema';
