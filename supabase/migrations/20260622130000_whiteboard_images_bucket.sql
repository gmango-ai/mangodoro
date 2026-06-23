-- Storage bucket for whiteboard image nodes.
--
-- Images are uploaded once and referenced by URL from the board snapshot, so
-- the (multiplayer) snapshot + realtime ops carry a short URL instead of a
-- multi-MB base64 blob — keeping broadcast payloads small and snapshots lean.
-- Mirrors the avatars bucket (public read, write-under-your-own-prefix).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'whiteboard-images',
    'whiteboard-images',
    true,
    8388608, -- 8 MB (the client downscales to <=1600px before upload)
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS: public read (board images aren't secret; served via public URL).
-- Authenticated users may write/replace/delete only under their own user_id
-- prefix — path is "<uid>/wb-<board>-<ts>.<ext>", same shape as avatars.

drop policy if exists "wb-images: public read" on storage.objects;
create policy "wb-images: public read"
  on storage.objects for select
  using (bucket_id = 'whiteboard-images');

drop policy if exists "wb-images: users write own" on storage.objects;
create policy "wb-images: users write own"
  on storage.objects for insert
  with check (
    bucket_id = 'whiteboard-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "wb-images: users update own" on storage.objects;
create policy "wb-images: users update own"
  on storage.objects for update
  using (
    bucket_id = 'whiteboard-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "wb-images: users delete own" on storage.objects;
create policy "wb-images: users delete own"
  on storage.objects for delete
  using (
    bucket_id = 'whiteboard-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

notify pgrst, 'reload schema';
