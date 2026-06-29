-- Room pin policy — who may pin a participant into everyone's view.
--
-- "Pin for everyone" writes the room's LiveKit metadata { pinnedIdentity }, so
-- every client focuses the same tile. Until now that was hard-coded to org
-- admins (enforced in the livekit-moderate edge function). This makes it a
-- per-room setting so a room can let its session leader, both, or everyone in
-- the call control the shared focus.
--
--   'admins'   — org admin / owner only (the previous behaviour; default)
--   'leaders'  — the active sync-session leader only
--   'both'     — an org admin OR the session leader
--   'everyone' — anyone in the call
--
-- The edge function reads rooms.pin_policy and authorises accordingly; the
-- client reads it only to decide whether to SHOW the pin affordance.

alter table public.rooms
  add column if not exists pin_policy text not null default 'admins'
    check (pin_policy in ('admins', 'leaders', 'both', 'everyone'));

-- Manager-checked setter (mirrors set_room_entry_policy): only the room's
-- creator, an org admin of its team, or a lead of a gating team may change it.
create or replace function public.set_room_pin_policy(
  p_room_id uuid,
  p_policy text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  if p_policy not in ('admins', 'leaders', 'both', 'everyone') then
    raise exception 'Invalid pin policy';
  end if;
  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;
  if not (
    public.is_org_admin_of_room(p_room_id)
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to change this room''s pin control';
  end if;
  update public.rooms set pin_policy = p_policy where id = p_room_id;
end;
$$;

grant execute on function public.set_room_pin_policy(uuid, text) to authenticated;
