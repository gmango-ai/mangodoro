-- BUGFIX (fix-forward): "Only the leader or controller may update the session"
-- when a non-leader attaches / detaches a whiteboard.
--
-- sync_sessions has a BEFORE UPDATE guard (sync_session_guard_participant_update,
-- 20260611150000) that runs as the CALLER and rejects any non-leader/controller
-- write with that error. link_whiteboard_to_session / unlink_whiteboard_from_session
-- write sync_sessions.whiteboard_id but never set the transaction-local
-- `sync.internal_update` bypass that the other trusted session RPCs
-- (take_sync_control, leave, transfer) use — so "anyone in the room can attach a
-- board" (20260628180000) was still blocked by the guard for non-leaders.
--
-- These functions already validate room participation + the whiteboard lock
-- (20260704120000), so they're trusted to flip the bypass. 20260704120000 was
-- applied to the shared DB before this bypass was added, so it can't be edited in
-- place — hence this new, later-timestamped migration re-defines both functions.

create or replace function public.link_whiteboard_to_session(
  p_session_id uuid,
  p_whiteboard_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_board public.whiteboards;
  v_locked boolean;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;
  -- Anyone in the room (an active participant) may link a whiteboard…
  if not exists (
    select 1 from public.sync_session_participants p
    where p.session_id = p_session_id and p.user_id = auth.uid() and p.left_at is null
  ) then
    raise exception 'Only someone in this room can change the whiteboard';
  end if;
  -- …unless this room's manager has locked the whiteboard feature, in which
  -- case only a manager may change it.
  if v_session.room_id is not null then
    select whiteboard_locked into v_locked from public.rooms where id = v_session.room_id;
    if coalesce(v_locked, false) and not (
      public.is_org_admin_of_room(v_session.room_id)
      or public.is_lead_of_any_gating_team(v_session.room_id)
      or exists (select 1 from public.rooms r where r.id = v_session.room_id and r.created_by = auth.uid())
    ) then
      raise exception 'The whiteboard is locked in this room';
    end if;
  end if;

  select * into v_board from public.whiteboards where id = p_whiteboard_id;
  if not found then raise exception 'Whiteboard not found'; end if;

  if v_board.scope = 'personal' then
    -- You can only bring your OWN personal board into a room.
    if v_board.owner_id <> auth.uid() then
      raise exception 'You can only share your own personal whiteboard';
    end if;
  else
    -- Org board: must be the session's team.
    if v_session.team_id is null or v_board.team_id <> v_session.team_id then
      raise exception 'Whiteboard and session must belong to the same team';
    end if;
  end if;

  -- Trusted RPC → bypass the leader/controller guard on sync_sessions.
  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
    set whiteboard_id = p_whiteboard_id
    where id = p_session_id;
end;
$$;

grant execute on function public.link_whiteboard_to_session(uuid, uuid) to authenticated;

create or replace function public.unlink_whiteboard_from_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_locked boolean;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  -- Anyone in the room (an active participant) may unlink…
  if not exists (
    select 1 from public.sync_session_participants p
    where p.session_id = p_session_id and p.user_id = auth.uid() and p.left_at is null
  ) then
    raise exception 'Only someone in this room can change the whiteboard';
  end if;
  -- …unless the whiteboard is locked, then managers only.
  if v_session.room_id is not null then
    select whiteboard_locked into v_locked from public.rooms where id = v_session.room_id;
    if coalesce(v_locked, false) and not (
      public.is_org_admin_of_room(v_session.room_id)
      or public.is_lead_of_any_gating_team(v_session.room_id)
      or exists (select 1 from public.rooms r where r.id = v_session.room_id and r.created_by = auth.uid())
    ) then
      raise exception 'The whiteboard is locked in this room';
    end if;
  end if;

  -- Trusted RPC → bypass the leader/controller guard on sync_sessions.
  perform set_config('sync.internal_update', '1', true);

  update public.sync_sessions
    set whiteboard_id = null
    where id = p_session_id;
end;
$$;

grant execute on function public.unlink_whiteboard_from_session(uuid) to authenticated;

notify pgrst, 'reload schema';
