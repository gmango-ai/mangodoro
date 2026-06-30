-- Let ANYONE in the room attach / detach the session whiteboard, not just the
-- session leader. A whiteboard is a shared surface — anybody present should be
-- able to bring one in or swap it, like opening a shared doc. Permission relaxes
-- from "leader only" to "an active participant of the session" (someone actually
-- in the room). The board's scope/team safety checks on link are unchanged.
--
-- Forward migration: CREATE OR REPLACE over functions from
-- 20260619160000 (unlink) and 20260628120000 (link). Later timestamp, so it wins
-- after both. The link body references whiteboards.scope (added in 20260628120000),
-- which applies first by timestamp order.

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
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;
  -- Anyone in the room (an active participant) may link a whiteboard.
  if not exists (
    select 1 from public.sync_session_participants p
    where p.session_id = p_session_id and p.user_id = auth.uid() and p.left_at is null
  ) then
    raise exception 'Only someone in this room can change the whiteboard';
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
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  -- Anyone in the room (an active participant) may unlink.
  if not exists (
    select 1 from public.sync_session_participants p
    where p.session_id = p_session_id and p.user_id = auth.uid() and p.left_at is null
  ) then
    raise exception 'Only someone in this room can change the whiteboard';
  end if;

  update public.sync_sessions
    set whiteboard_id = null
    where id = p_session_id;
end;
$$;

grant execute on function public.unlink_whiteboard_from_session(uuid) to authenticated;

notify pgrst, 'reload schema';
