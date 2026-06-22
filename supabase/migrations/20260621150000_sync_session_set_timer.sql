-- Widget timer toggles on a SYNCED session were failing with HTTP 500
-- ("db write failed"). The activity-action edge function writes the timer as
-- the SERVICE ROLE (no user JWT — auth is the per-activity secret), so its
-- UPDATE on sync_sessions has auth.uid() = null. The before-update guard
-- sync_session_guard_participant_update() then raises "Only the leader or
-- controller may update the session" because it only allows the leader, the
-- controller, or a trusted RPC that sets the sync.internal_update flag. (RLS is
-- bypassed by the service role, but triggers are not.)
--
-- This RPC is the trusted server-side timer writer: it sets the same
-- transaction-local flag that take_sync_control / leave / transfer use, then
-- writes only the timer fields. The before-trigger recomputes ends_at, which we
-- return so the Live Activity matches the DB exactly. EXECUTE is granted only to
-- service_role (called from the edge function) — never anon/authenticated.

create or replace function public.sync_session_set_timer(
  p_session_id uuid,
  p_is_running boolean,
  p_remaining_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ends_at timestamptz;
begin
  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
     set is_running = p_is_running,
         remaining_seconds = greatest(0, p_remaining_seconds)
   where id = p_session_id
   returning ends_at into v_ends_at;

  return v_ends_at;
end;
$$;

revoke all on function public.sync_session_set_timer(uuid, boolean, integer) from public;
revoke all on function public.sync_session_set_timer(uuid, boolean, integer) from anon;
revoke all on function public.sync_session_set_timer(uuid, boolean, integer) from authenticated;
grant execute on function public.sync_session_set_timer(uuid, boolean, integer) to service_role;
