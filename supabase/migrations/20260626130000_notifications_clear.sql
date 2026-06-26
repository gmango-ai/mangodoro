-- Let a recipient CLEAR (delete) their own notifications. The table previously
-- had only SELECT + UPDATE(read_at) for recipients (20260623170000), so the
-- inbox could be marked read but never emptied. This adds a DELETE policy scoped
-- to the caller's own rows — inserts still go only through emit_notification
-- (SECURITY DEFINER), so this can't be used to touch anyone else's rows.
drop policy if exists "recipient deletes own notifications" on public.notifications;
create policy "recipient deletes own notifications"
  on public.notifications for delete
  using (recipient_user_id = auth.uid());
