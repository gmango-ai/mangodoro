-- Whiteboards: personal vs org scope (mirrors whiteboard_templates).
--
-- Before: every whiteboard was team-owned (team_id NOT NULL), readable +
-- editable by the whole team. Now a board can be `personal` (private to its
-- owner) or `org` (team-shared, the old behaviour). A personal board is
-- still ROOM-LINKABLE: its owner can attach it to a room session, and while
-- it's linked, the session's participants can read + edit it (so the board
-- can be brought into a call without making it a permanent team board).

alter table public.whiteboards
  add column if not exists scope text not null default 'org' check (scope in ('personal', 'org')),
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Backfill owner_id before tightening — existing rows are all org boards.
update public.whiteboards set owner_id = created_by where owner_id is null;

-- Personal boards have no team; org boards must have one.
alter table public.whiteboards alter column team_id drop not null;

alter table public.whiteboards drop constraint if exists whiteboards_scope_team_check;
alter table public.whiteboards add constraint whiteboards_scope_team_check
  check (
    (scope = 'org' and team_id is not null)
    or (scope = 'personal' and team_id is null and owner_id is not null)
  );

create index if not exists whiteboards_owner_idx
  on public.whiteboards (owner_id) where scope = 'personal' and archived_at is null;

-- ── RLS (additive permissive policies; existing team policies stay) ──
-- The existing "Team members can read/create/update whiteboards" + "Admins
-- can delete whiteboards" policies only match org boards (team_id null fails
-- their `team_id in (...)` test), so these new policies just widen access
-- for personal + room-linked boards.

-- A reusable predicate: this board is linked to an active session the caller
-- is currently in. Used so room participants can read/edit a board (incl. a
-- personal one) that's been brought into their room.
create or replace function public.whiteboard_in_my_active_session(p_whiteboard_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.sync_sessions s
    join public.sync_session_participants p on p.session_id = s.id
    where s.whiteboard_id = p_whiteboard_id
      and s.status = 'active'
      and p.user_id = auth.uid()
      and p.left_at is null
  );
$$;
grant execute on function public.whiteboard_in_my_active_session(uuid) to authenticated;

drop policy if exists "Owners read personal whiteboards" on public.whiteboards;
create policy "Owners read personal whiteboards" on public.whiteboards for select
  using (scope = 'personal' and owner_id = auth.uid());

drop policy if exists "Participants read linked whiteboard" on public.whiteboards;
create policy "Participants read linked whiteboard" on public.whiteboards for select
  using (public.whiteboard_in_my_active_session(id));

drop policy if exists "Owners create personal whiteboards" on public.whiteboards;
create policy "Owners create personal whiteboards" on public.whiteboards for insert
  with check (
    scope = 'personal' and created_by = auth.uid()
    and owner_id = auth.uid() and team_id is null
  );

drop policy if exists "Owners update personal whiteboards" on public.whiteboards;
create policy "Owners update personal whiteboards" on public.whiteboards for update
  using (scope = 'personal' and owner_id = auth.uid())
  with check (scope = 'personal' and owner_id = auth.uid());

drop policy if exists "Participants update linked whiteboard" on public.whiteboards;
create policy "Participants update linked whiteboard" on public.whiteboards for update
  using (public.whiteboard_in_my_active_session(id))
  with check (public.whiteboard_in_my_active_session(id));

drop policy if exists "Owners delete personal whiteboards" on public.whiteboards;
create policy "Owners delete personal whiteboards" on public.whiteboards for delete
  using (scope = 'personal' and owner_id = auth.uid());

-- ── link RPC: allow linking your own personal board, not just same-team ──
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

notify pgrst, 'reload schema';
