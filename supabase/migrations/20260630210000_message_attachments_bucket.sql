-- Messaging v2 — Phase 7 (storage): the message-attachments bucket.
--
-- Public bucket (matches avatars / whiteboard-images / pomodoro-sounds), so the
-- client's getPublicUrl() works without signed-URL plumbing. Paths are
-- `${conversationId}/${messageId}/${ts}-${rand}.${ext}`, so folder[1] is the
-- conversation id. Uploads are gated to people who can access that conversation
-- (DM/group participants or channel members) via can_access_conversation; the
-- dm_message_attachments row INSERT additionally restricts to the message sender.
--
-- Privacy note: a public bucket serves files via the CDN to anyone holding the
-- (unguessable, uuid-pathed) URL. If DM attachments need hard isolation later,
-- flip the bucket private and switch the client to createSignedUrl.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'message-attachments',
    'message-attachments',
    true,
    10485760, -- 10 MB (matches messageAttachments.js MAX_BYTES)
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (the bucket is public; this covers the authenticated list/download
-- API — anonymous GET via the public URL is served regardless).
drop policy if exists "message-attachments: read" on storage.objects;
create policy "message-attachments: read"
  on storage.objects for select
  using (bucket_id = 'message-attachments');

-- Upload only into a conversation the caller can access.
drop policy if exists "message-attachments: members upload" on storage.objects;
create policy "message-attachments: members upload"
  on storage.objects for insert
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] is not null
    and public.can_access_conversation(((storage.foldername(name))[1])::uuid)
  );

-- Uploader may remove their own files (storage sets owner = uploader uid).
drop policy if exists "message-attachments: owner deletes" on storage.objects;
create policy "message-attachments: owner deletes"
  on storage.objects for delete
  using (
    bucket_id = 'message-attachments'
    and owner = auth.uid()
  );

notify pgrst, 'reload schema';
