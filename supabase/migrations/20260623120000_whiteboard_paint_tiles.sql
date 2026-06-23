-- Collaborative writes for the whiteboard raster paint layer.
--
-- The paint layer stores each painted tile as a PNG at
-- "paint/<board>/<tx>_<ty>.png" in the whiteboard-images bucket. Unlike image
-- nodes (written under the uploader's own "<uid>/" prefix), paint tiles are a
-- SHARED surface — any board member must be able to overwrite any tile — so
-- writes are scoped to the "paint/" prefix for authenticated users rather than
-- to a per-user folder. Reads stay public via the existing select policy.
--
-- Note: board-level authorization is NOT enforced at the storage layer (that
-- would need a membership join from the path's board id). The app is
-- invite-gated and board images are already public-read, so any authenticated
-- user being able to write a paint tile is an acceptable trade-off for v1.

drop policy if exists "wb-images: paint writes" on storage.objects;
create policy "wb-images: paint writes"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'whiteboard-images'
    and (storage.foldername(name))[1] = 'paint'
  );

drop policy if exists "wb-images: paint updates" on storage.objects;
create policy "wb-images: paint updates"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'whiteboard-images'
    and (storage.foldername(name))[1] = 'paint'
  )
  with check (
    bucket_id = 'whiteboard-images'
    and (storage.foldername(name))[1] = 'paint'
  );

drop policy if exists "wb-images: paint deletes" on storage.objects;
create policy "wb-images: paint deletes"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'whiteboard-images'
    and (storage.foldername(name))[1] = 'paint'
  );

notify pgrst, 'reload schema';
