-- Fix infinite recursion in the "Open mode participants update timer" policy
-- added in 20260527130000_sync_control_mode.sql.
--
-- The original USING/WITH CHECK clause did:
--   exists (select 1 from public.sync_session_participants p where p.session_id = id ...)
-- which re-evaluates the SELECT policy on sync_session_participants, which
-- itself references sync_session_participants, triggering recursion.
--
-- Fix: route the membership check through the existing security-definer
-- helper `public.get_my_sync_session_ids()` (defined in
-- 20260519140000_fix_rls_recursion.sql), which bypasses RLS for the lookup.

drop policy if exists "Open mode participants update timer" on public.sync_sessions;

create policy "Open mode participants update timer"
  on public.sync_sessions for update
  using (
    control_mode = 'open'
    and status = 'active'
    and id in (select public.get_my_sync_session_ids())
  )
  with check (
    control_mode = 'open'
    and status = 'active'
    and id in (select public.get_my_sync_session_ids())
  );

notify pgrst, 'reload schema';
