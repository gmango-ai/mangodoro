-- Allow a user to always read their own sync_session_participants row,
-- even after `left_at` is set.
--
-- Background: the "Participants read members" policy uses
-- get_my_sync_session_ids(), which filters to rows where left_at IS NULL.
-- That means once the leader kicks a user (sets left_at), the kicked user
-- loses SELECT access to their own row and can't tell why they were
-- removed. Worse, our client-side self-heal would observe itself "missing"
-- from the active list and silently call join_sync_session again,
-- effectively rejoining the user that was just kicked.
--
-- This additive policy is OR-combined with the existing one, so other
-- participants' visibility is unchanged.

drop policy if exists "Read own participant row" on public.sync_session_participants;
create policy "Read own participant row"
  on public.sync_session_participants for select
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
