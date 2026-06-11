-- Ensure take_sync_control is callable via PostgREST (idempotent).
-- Requires 20260611120000_sync_controller.sql (controller_id column) first.

grant execute on function public.take_sync_control(uuid) to authenticated;

notify pgrst, 'reload schema';
