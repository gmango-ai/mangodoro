-- Fix: creating a milestone failed with "new row violates row-level security
-- policy for table milestones".
--
-- created_by is NOT NULL with no default, and the insert policy requires
-- created_by = auth.uid() — but the client insert never set created_by, so the
-- row's created_by was null and the WITH CHECK failed. Default it to the caller
-- (same pattern as other own-rows tables) so inserts satisfy the policy without
-- the client having to pass it.
alter table public.milestones alter column created_by set default auth.uid();
