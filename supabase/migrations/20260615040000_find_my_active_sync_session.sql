-- Server-authoritative discovery: returns the active sync_session row
-- for the calling user, if any. Used by the client when cold-loading
-- on a fresh device — previously rehydration only consulted local
-- storage, so a user already joined to a session on device A would
-- show up on device B as "no session" and have to manually re-join.
--
-- A user can technically appear in more than one active session
-- (separate teams, separate rooms) — we return the most recently
-- joined, which is the one the user is mentally "in".
--
-- The `participant_count` column lets the client display a one-line
-- "still in {room name} with N others" affordance without a second
-- request.

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
  order by p.joined_at desc
  limit 1;
$$;

grant execute on function public.find_my_active_sync_session() to authenticated;
