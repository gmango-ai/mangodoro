-- Link a whiteboard to a sync_session, mirroring the retro link
-- (20260616120000_sync_session_retro.sql). A meeting room can attach a
-- whiteboard so everyone in the call sees the same board in their room
-- layout. The board keeps existing independently at /whiteboards/:id —
-- the link is transient (session-scoped) and clears when the session ends.
--
-- Set-null on whiteboard delete keeps the session row valid; the UI
-- treats a null whiteboard_id as "no whiteboard linked."

alter table public.sync_sessions
  add column if not exists whiteboard_id uuid
    references public.whiteboards(id) on delete set null;

create index if not exists sync_sessions_whiteboard_id_idx
  on public.sync_sessions (whiteboard_id) where whiteboard_id is not null;

-- ── RPCs ──────────────────────────────────────────────────────

-- link_whiteboard_to_session: only the session leader may attach, and
-- the board must belong to the same team as the session.
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
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can link a whiteboard';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;

  select * into v_board from public.whiteboards where id = p_whiteboard_id;
  if not found then raise exception 'Whiteboard not found'; end if;

  if v_session.team_id is null or v_board.team_id <> v_session.team_id then
    raise exception 'Whiteboard and session must belong to the same team';
  end if;

  update public.sync_sessions
    set whiteboard_id = p_whiteboard_id
    where id = p_session_id;
end;
$$;

grant execute on function public.link_whiteboard_to_session(uuid, uuid) to authenticated;

-- unlink_whiteboard_from_session: leader-only. Setting whiteboard_id back
-- to null doesn't touch the board itself — it just severs the link.
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
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can unlink the whiteboard';
  end if;

  update public.sync_sessions
    set whiteboard_id = null
    where id = p_session_id;
end;
$$;

grant execute on function public.unlink_whiteboard_from_session(uuid) to authenticated;

notify pgrst, 'reload schema';
