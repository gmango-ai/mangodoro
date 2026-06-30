-- Messaging v2 — tighten message-attachments uploads to the message's sender.
--
-- 20260630210000 was edited in place after it had already been applied to the
-- shared DB ("Restrict message attachment uploads to senders"), so `db push`
-- skips it and the tightened policy never lands. This migration re-applies that
-- policy as a new, trackable step. Path layout is
-- `${conversationId}/${messageId}/${file}`, so folder[1] = conversation and
-- folder[2] = message; a user may only upload into a message they sent.

drop policy if exists "message-attachments: members upload" on storage.objects;
create policy "message-attachments: members upload"
  on storage.objects for insert
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] is not null
    and public.can_access_conversation(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1 from public.dm_messages m
       where m.id = ((storage.foldername(name))[2])::uuid
         and m.conversation_id = ((storage.foldername(name))[1])::uuid
         and m.sender_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
