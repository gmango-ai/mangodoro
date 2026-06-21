-- Heartbeat / liveness foundation for sync sessions (room lifecycle).
--
-- Membership (sync_session_participants) is tracked per *user*, but the
-- events that should drive cleanup — tab close, navigation, network
-- drop — happen per *connection*, and there was no server-side liveness
-- signal. So a closed tab left a ghost participant row with left_at = null
-- forever: the room never emptied, the meeting timer never reset, and a
-- private room stayed locked.
--
-- last_seen_at is that missing signal. Connected clients stamp it on a
-- steady cadence (see SyncSessionContext). Everything downstream —
-- read-time liveness filtering, empty-room teardown, leader reassignment,
-- video teardown — keys off "who has a fresh last_seen_at right now"
-- rather than "who has left_at = null".
--
-- This migration is intentionally additive: it adds the column + a
-- heartbeat RPC and changes NO existing behavior. Consumers land in
-- later migrations.

alter table public.sync_session_participants
  add column if not exists last_seen_at timestamptz not null default now();

-- Stamps the caller's liveness for a session. Security definer so it
-- works regardless of the participant-update RLS policy, and so it can
-- be called cheaply on a timer without round-tripping policy checks.
-- Only touches the caller's own active row; a no-op if they aren't an
-- active participant (e.g. a stale tab whose row was already cleaned up).
create or replace function public.heartbeat_sync_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sync_session_participants
     set last_seen_at = pg_catalog.now()
   where session_id = p_session_id
     and user_id = auth.uid()
     and left_at is null;
end;
$$;

grant execute on function public.heartbeat_sync_session(uuid) to authenticated;

-- Partial index for the sweeper / liveness queries that will filter on
-- "active participants seen recently" (added now so later migrations and
-- read-time queries don't trigger seq scans on busy sessions).
create index if not exists sync_participants_last_seen_active
  on public.sync_session_participants (session_id, last_seen_at)
  where left_at is null;
