-- Team branding: icon image, accent color, and richer team metadata.
--
-- The existing `teams` table already has `name`; admins can rename via the
-- standard UPDATE path. This migration adds an icon image (stored in a new
-- public 'team-icons' bucket) and an accent color used in the UI.

alter table public.teams
  add column if not exists icon_url text,
  add column if not exists color text not null default '#14b8a6';

-- Storage bucket for team icons. Files live under "{team_id}/icon-..." so
-- the RLS check can verify the uploader is an admin of that team.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'team-icons',
    'team-icons',
    true,
    2097152, -- 2 MB
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read. Writes restricted to admins of the team whose id is the
-- first path segment.
drop policy if exists "team-icons: public read" on storage.objects;
create policy "team-icons: public read"
  on storage.objects for select
  using (bucket_id = 'team-icons');

drop policy if exists "team-icons: admins write" on storage.objects;
create policy "team-icons: admins write"
  on storage.objects for insert
  with check (
    bucket_id = 'team-icons'
    and exists (
      select 1 from public.team_members tm
      where tm.team_id::text = (storage.foldername(name))[1]
        and tm.user_id = auth.uid()
        and tm.role = 'admin'
    )
  );

drop policy if exists "team-icons: admins update" on storage.objects;
create policy "team-icons: admins update"
  on storage.objects for update
  using (
    bucket_id = 'team-icons'
    and exists (
      select 1 from public.team_members tm
      where tm.team_id::text = (storage.foldername(name))[1]
        and tm.user_id = auth.uid()
        and tm.role = 'admin'
    )
  );

drop policy if exists "team-icons: admins delete" on storage.objects;
create policy "team-icons: admins delete"
  on storage.objects for delete
  using (
    bucket_id = 'team-icons'
    and exists (
      select 1 from public.team_members tm
      where tm.team_id::text = (storage.foldername(name))[1]
        and tm.user_id = auth.uid()
        and tm.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
