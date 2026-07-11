-- Meetings — Phase 1d: the meeting-recordings storage bucket.
--
-- PRIVATE (unlike message-attachments) — recorded meeting audio is sensitive.
-- LiveKit Egress writes objects here via the bucket's S3-compatible endpoint
-- (its own S3 key, not a user session); the process-recording pipeline reads
-- them with the service role (bypasses RLS). Paths are
-- `${roomId}/${recordingId}/audio.ogg`, so foldername[1] is the room id.
--
-- The read policy below is only for a possible future in-app player — no client
-- writes are allowed (egress owns the write path via S3).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'meeting-recordings',
    'meeting-recordings',
    false,
    524288000, -- 500 MB
    array['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'application/vnd.apple.mpegurl', 'video/mp2t']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated read for members of the recording's room team (future player).
drop policy if exists "meeting-recordings: team reads" on storage.objects;
create policy "meeting-recordings: team reads"
  on storage.objects for select
  using (
    bucket_id = 'meeting-recordings'
    and (storage.foldername(name))[1] is not null
    and exists (
      select 1 from public.rooms rm
       where rm.id = ((storage.foldername(name))[1])::uuid
         and public.is_team_member(rm.team_id)
    )
  );

notify pgrst, 'reload schema';
