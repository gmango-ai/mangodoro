-- Tighten the sync_session lifecycle:
--   • When the LAST active participant leaves, the session row is
--     hard-deleted (not just soft-ended) so the table doesn't grow
--     unbounded.
--   • An end_sync_session RPC replaces the bare client-side UPDATE;
--     it deletes the row atomically with a leader-only permission
--     check.
--   • The sweeper for expired meeting sessions now DELETEs the rows
--     too (was UPDATE → ended).
--   • A new BEFORE DELETE trigger on sync_sessions clears the linked
--     private room's invite_code, so private rooms automatically
--     return to "unlocked / open to anyone" the moment their session
--     dies. Combined with the existing first-join trigger that mints
--     the code, this gives:
--       no one inside        → unlocked
--       1st person joins     → code minted, room locked
--       more join via code   → still locked
--       last person leaves   → session deleted, room unlocked

-- ── 1. Unlock private rooms when their session goes away ───────────
create or replace function public.unlock_private_room_on_session_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.room_id is not null then
    update public.rooms
      set invite_code = null
      where id = old.room_id and kind = 'private';
  end if;
  return old;
end;
$$;

drop trigger if exists tr_sync_session_unlock_room on public.sync_sessions;
create trigger tr_sync_session_unlock_room
  before delete on public.sync_sessions
  for each row execute function public.unlock_private_room_on_session_delete();

-- ── 2. leave_sync_session: delete when last out ────────────────────
create or replace function public.leave_sync_session(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_next_leader uuid;
  v_others int;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then
    -- Already gone — idempotent success.
    return json_build_object('ok', true, 'ended', true);
  end if;

  -- Count active participants other than the caller.
  select count(*) into v_others
  from public.sync_session_participants
  where session_id = p_session_id
    and user_id <> auth.uid()
    and left_at is null;

  if v_others = 0 then
    -- Last person out. Delete the session row; the BEFORE DELETE
    -- trigger unlocks the private room (if any), the
    -- ON DELETE CASCADE on sync_session_participants takes the
    -- participant rows with it.
    delete from public.sync_sessions where id = p_session_id;
    return json_build_object('ok', true, 'ended', true);
  end if;

  -- Still folks here — mark caller as left.
  update public.sync_session_participants
    set left_at = pg_catalog.now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  -- If the caller was the leader, promote the next-joined active
  -- participant (mirrors the previous behavior).
  if v_session.leader_id = auth.uid() then
    select user_id into v_next_leader
    from public.sync_session_participants
    where session_id = p_session_id
      and user_id <> auth.uid()
      and left_at is null
    order by joined_at asc
    limit 1;
    if v_next_leader is not null then
      update public.sync_sessions
        set leader_id = v_next_leader
        where id = p_session_id;
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'new_leader_id', v_next_leader,
    'ended', false
  );
end;
$$;

grant execute on function public.leave_sync_session(uuid) to authenticated;

-- ── 3. end_sync_session: leader-only hard delete ───────────────────
create or replace function public.end_sync_session(
  p_session_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then
    return json_build_object('ok', true, 'ended', true);
  end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the leader can end the session';
  end if;
  delete from public.sync_sessions where id = p_session_id;
  return json_build_object('ok', true, 'ended', true);
end;
$$;

grant execute on function public.end_sync_session(uuid) to authenticated;

-- ── 4. Sweeper: delete (not soft-end) expired meeting sessions ─────
create or replace function public.sweep_expired_sync_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with deleted as (
    delete from public.sync_sessions
     where expires_at is not null
       and expires_at <= pg_catalog.now()
     returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

grant execute on function public.sweep_expired_sync_sessions() to authenticated;
