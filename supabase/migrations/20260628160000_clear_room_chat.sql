-- Clear a room's chat: a room manager soft-deletes every message in the room.
-- The chat_messages UPDATE policy is authors-only, so managers go through this
-- security-definer RPC instead (the original chat migration deferred exactly
-- this "moderation RPC").
--
-- Soft delete (set deleted_at) rather than DELETE so the redaction propagates
-- live: useRoomChat subscribes to INSERT + UPDATE and removes any row whose
-- deleted_at is set, so every connected client clears in place. A hard DELETE
-- would NOT propagate (no DELETE subscription).
--
-- Permission mirrors the other room-management RPCs — admin of the room's org,
-- the room's creator, or a lead of any org_team gating the room — but is
-- written inline so it depends only on already-deployed tables (no coupling to
-- the in-flight room-privacy helpers).
create or replace function public.clear_room_chat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_team_id uuid;
begin
  select created_by, team_id into v_creator, v_team_id
    from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;

  if not (
    v_creator = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = v_team_id and tm.user_id = auth.uid() and tm.role = 'admin'
    )
    or exists (
      select 1
      from public.room_teams rt
      join public.org_team_members otm on otm.org_team_id = rt.org_team_id
      where rt.room_id = p_room_id and otm.user_id = auth.uid() and otm.role = 'lead'
    )
  ) then
    raise exception 'You do not have permission to clear this room''s chat';
  end if;

  update public.chat_messages
     set deleted_at = now()
   where room_id = p_room_id and deleted_at is null;
end;
$$;

grant execute on function public.clear_room_chat(uuid) to authenticated;

notify pgrst, 'reload schema';
