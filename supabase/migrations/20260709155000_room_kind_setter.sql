-- Change a room's TYPE after creation.
--
-- Until now `kind` (general / meeting / private) could only be set at create
-- time via create_room_v2. Room settings let managers edit everything else
-- about a room; type was the one immutable field. This adds a manager-checked
-- setter that mirrors the create-time rules and keeps the coupled columns
-- consistent:
--
--   • max_duration_minutes only exists on meeting rooms
--     (constraint rooms_max_duration_meeting_only) → cleared when a room
--     leaves 'meeting'.
--   • invite_code (legacy per-room lock) only exists on private rooms
--     (constraint rooms_invite_code_only_private) → cleared when a room
--     leaves 'private'.
--   • Becoming 'private' should be locked-but-usable exactly like a freshly
--     created private room: an OPEN room is switched to a 'code' policy and a
--     shareable PIN is seeded (managers view/share it from Room settings).
--
-- Permissions mirror the other room setters (set_room_pin_policy et al.):
-- the room's creator, an org admin of its team, or a lead of a gating team.
-- Promoting a room to 'general' additionally requires org admin — same rule
-- create_room_v2 enforces ("Only org admins can create general rooms").

create or replace function public.set_room_kind(
  p_room_id uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.room_kind;
  v_creator uuid;
  v_is_admin boolean;
begin
  if p_kind not in ('general', 'meeting', 'private') then
    raise exception 'Invalid room kind';
  end if;
  v_kind := p_kind::public.room_kind;

  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;

  v_is_admin := public.is_org_admin_of_room(p_room_id);

  if not (
    v_is_admin
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to change this room''s type';
  end if;

  if v_kind = 'general' and not v_is_admin then
    raise exception 'Only org admins can make a room general';
  end if;

  update public.rooms
     set kind = v_kind,
         max_duration_minutes = case when v_kind = 'meeting'
                                     then max_duration_minutes else null end,
         invite_code = case when v_kind = 'private'
                                     then invite_code else null end,
         entry_policy = case
           when v_kind = 'private' and entry_policy = 'open'
             then 'code'::public.room_entry_policy
           else entry_policy
         end
   where id = p_room_id;

  -- Seed a shareable PIN so a newly-private room is locked but immediately
  -- usable (matches create_room_v2). No-op if one already exists.
  if v_kind = 'private' then
    insert into public.room_secrets (room_id, code, set_by)
    values (
      p_room_id,
      upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6)),
      auth.uid()
    )
    on conflict (room_id) do nothing;
  end if;
end;
$$;

grant execute on function public.set_room_kind(uuid, text) to authenticated;
