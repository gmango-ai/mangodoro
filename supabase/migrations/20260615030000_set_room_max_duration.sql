-- Allows editing a meeting room's max_duration_minutes after creation.
-- Only the room's creator OR an org admin may change it (mirrors the
-- existing rename/color/gating permission model). The CHECK on the
-- rooms table still enforces that only meeting kinds can carry a
-- non-null duration — this RPC just gates who can write the value.

create or replace function public.set_room_max_duration(
  p_room_id uuid,
  p_minutes int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_is_admin boolean;
begin
  if p_minutes is not null and p_minutes <= 0 then
    raise exception 'Max duration must be a positive number of minutes';
  end if;

  select * into v_room from public.rooms where id = p_room_id and archived_at is null;
  if not found then raise exception 'Room not found'; end if;
  if v_room.kind <> 'meeting' then
    raise exception 'Only meeting rooms can have a max duration';
  end if;

  select bool_or(role = 'admin') into v_is_admin
    from public.team_members
    where team_id = v_room.team_id and user_id = auth.uid();

  if not (coalesce(v_is_admin, false) or v_room.created_by = auth.uid()) then
    raise exception 'Only org admins or the room creator can change this';
  end if;

  update public.rooms set max_duration_minutes = p_minutes where id = p_room_id;
end;
$$;

grant execute on function public.set_room_max_duration(uuid, int) to authenticated;
