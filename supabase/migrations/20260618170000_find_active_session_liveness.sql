-- Read-time liveness for cross-device discovery (follow-up to 2/6).
--
-- find_my_active_sync_session is the cold-load rehydrate path. Without a
-- liveness check it would resurrect a session the user had abandoned
-- (their own participant row still left_at = null, just stale), adopting
-- the frozen meeting timer instead of getting a fresh room — defeating
-- reset-to-zero in the window before the sweep runs.
--
-- Only return a session that still has at least one LIVE participant.
-- For the returning user this means:
--   • quick reload (seen <120s ago)  → still live → session returned, timer kept
--   • long absence, no live device   → not returned → fresh start (reset to zero)
--   • another device still connected  → that device keeps it live → returned (multi-device intact)
--
-- GRACE WINDOW 120s — keep in sync with the other lifecycle functions and
-- PRESENCE_GRACE_MS in src/lib/syncSession.js.

create or replace function public.find_my_active_sync_session()
returns table (
  id uuid,
  leader_id uuid,
  controller_id uuid,
  control_mode text,
  visibility text,
  status text,
  join_code text,
  team_id uuid,
  room_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  participant_count int
)
language sql
security definer
set search_path = ''
as $$
  select
    s.id, s.leader_id, s.controller_id, s.control_mode, s.visibility,
    s.status, s.join_code, s.team_id, s.room_id, s.expires_at, s.created_at,
    (
      select count(*)::int
      from public.sync_session_participants p2
      where p2.session_id = s.id and p2.left_at is null
    ) as participant_count
  from public.sync_sessions s
  join public.sync_session_participants p
    on p.session_id = s.id
   and p.user_id = auth.uid()
   and p.left_at is null
  where s.status = 'active'
    and exists (
      select 1
      from public.sync_session_participants p3
      where p3.session_id = s.id
        and p3.left_at is null
        and p3.last_seen_at > pg_catalog.now() - interval '120 seconds'
    )
  order by p.joined_at desc
  limit 1;
$$;

grant execute on function public.find_my_active_sync_session() to authenticated;
