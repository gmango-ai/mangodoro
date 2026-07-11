-- Fix the meeting-recordings read policy.
--
-- The original policy (20260707120300) parsed the room id with an unqualified
-- `name` inside `EXISTS (... FROM rooms rm ...)`. Because rooms also has a `name`
-- column, Postgres bound `name` to rooms.name, so it computed the folder of the
-- ROOM'S DISPLAY NAME instead of the storage object key — no room ever matched,
-- and createSignedUrl was denied (storage masks the denial as HTTP 400).
--
-- Qualify storage.objects.name so the room id comes from the object key
-- `{roomId}/{recordingId}/audio.ogg`.

drop policy if exists "meeting-recordings: team reads" on storage.objects;
create policy "meeting-recordings: team reads"
  on storage.objects for select
  using (
    bucket_id = 'meeting-recordings'
    and (storage.foldername(storage.objects.name))[1] is not null
    and exists (
      select 1 from public.rooms rm
       where rm.id = ((storage.foldername(storage.objects.name))[1])::uuid
         and public.is_team_member(rm.team_id)
    )
  );
