-- Per-room "lock the whiteboard feature" toggle.
--
-- Default behaviour (unchanged): ANYONE in the room may attach / swap / detach
-- the shared whiteboard — a shared surface, like opening a shared doc (see
-- 20260628180000_anyone_links_whiteboard). This migration lets a room's manager
-- LOCK that down: when rooms.whiteboard_locked = true, only the room's managers
-- (creator / org admin of its team / a lead of a gating team) may change the
-- board. Everyone else in the room keeps read access to whatever is attached.
--
-- Fresh timestamp (latest applied is 20260703120000); shared DB across branches.

-- ── 1. Per-room toggle ───────────────────────────────────────
alter table public.rooms
  add column if not exists whiteboard_locked boolean not null default false;

-- Manager-checked setter (mirrors set_room_knock_enabled): only the room's
-- creator, an org admin of its team, or a lead of a gating team may toggle it.
create or replace function public.set_room_whiteboard_lock(
  p_room_id uuid,
  p_locked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;
  if not (
    public.is_org_admin_of_room(p_room_id)
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to change this room''s whiteboard setting';
  end if;
  update public.rooms set whiteboard_locked = coalesce(p_locked, false) where id = p_room_id;
end;
$$;

grant execute on function public.set_room_whiteboard_lock(uuid, boolean) to authenticated;

-- ── 2. Gate link / unlink on the lock ────────────────────────
-- CREATE OR REPLACE over 20260628180000's versions, adding a lock check after
-- the "are you in this room" check. When the room is locked, only its managers
-- may change the board; the rest of the body (scope/team safety) is unchanged.
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

  update public.sync_sessions
    set whiteboard_id = null
    where id = p_session_id;
end;
$$;

grant execute on function public.unlink_whiteboard_from_session(uuid) to authenticated;

notify pgrst, 'reload schema';
