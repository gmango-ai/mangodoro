-- Fix: clearing a notification didn't stick across reload.
--
-- notification_deliveries had SELECT + UPDATE policies but no DELETE policy, so
-- the "Clear" action (a hard DELETE scoped by RLS to the caller's own rows) hit
-- 0 rows — PostgREST returns success with no error on a 0-row delete, so the
-- optimistic UI dropped the item while the row survived and the next reload
-- (listNotifications) brought it right back. Grant recipients DELETE on their
-- own deliveries so clear-one / clear-all actually persist.
drop policy if exists "recipient deletes own deliveries" on public.notification_deliveries;
create policy "recipient deletes own deliveries"
  on public.notification_deliveries for delete
  using (recipient_user_id = auth.uid());
