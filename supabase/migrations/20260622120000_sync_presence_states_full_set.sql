-- Align sync-participant presence with the global presence vocabulary.
--
-- The StatusSetter (and the global set_user_status RPC, migration
-- 20260527150000) support five presence states:
--   active, away, in_meeting, heads_down, available
-- but the sync_session_participants column CHECK and the
-- set_sync_participant_status RPC (migration 20260520170000) were never
-- widened past the original three (active, away, in_meeting). So picking
-- "Available" or "Heads-down" *while in a sync session* failed the RPC with
-- "Invalid presence_state". Bring both up to the full set.

-- ── widen the column CHECK constraint ────────────────────────
alter table public.sync_session_participants
  drop constraint if exists sync_session_participants_presence_state_check;

alter table public.sync_session_participants
  add constraint sync_session_participants_presence_state_check
    check (presence_state in ('active', 'away', 'in_meeting', 'heads_down', 'available'));

-- ── widen the RPC's validation to match ──────────────────────
create or replace function public.set_sync_participant_status(
  p_session_id uuid,
  p_status text default null,
  p_presence_state text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
  v_presence text;
begin
  v_clean := coalesce(substring(trim(coalesce(p_status, '')) from 1 for 80), '');
  v_presence := nullif(p_presence_state, '');

  if v_presence is not null
     and v_presence not in ('active', 'away', 'in_meeting', 'heads_down', 'available') then
    return json_build_object('error', 'Invalid presence_state');
  end if;

  update public.sync_session_participants
    set status = case when p_status is not null then v_clean else status end,
        presence_state = coalesce(v_presence, presence_state),
        status_updated_at = now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  if not found then
    return json_build_object('error', 'You are not an active participant');
  end if;

  return json_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
