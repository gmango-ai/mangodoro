-- Movable devices: let some kiosks switch which room they're in (e.g. move a
-- display into a meeting room when needed). A device is otherwise read-only and
-- pinned; this adds an opt-in `movable` flag and the ONE narrow write path a
-- device gets — changing only its OWN org_devices.room_id, only to a room in its
-- own org. Admins can also flip `movable` and reassign any device remotely.
--
-- No edge-function change needed: mint-livekit-token already reads the LIVE
-- org_devices.room_id, and current_device_room() (the RLS anchor) reads it too,
-- so updating that one column re-points the device's token + read scope.

alter table public.org_devices
  add column if not exists movable boolean not null default false;

-- A MOVABLE device may read its org's rooms (id/name) to populate the switcher.
-- Non-movable devices keep seeing only their pinned room (existing policy).
drop policy if exists "movable device reads org rooms" on public.rooms;
create policy "movable device reads org rooms"
  on public.rooms for select
  using (
    team_id = public.current_device_org()
    and exists (
      select 1 from public.org_devices
       where user_id = auth.uid() and revoked_at is null and movable
    )
  );

-- Self-service switch for a movable device. SECURITY DEFINER so the otherwise
-- write-less device can update only its own row, and only to a room in its org.
create or replace function public.set_device_room(new_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.org_devices%rowtype;
begin
  select * into dev
    from public.org_devices
   where user_id = auth.uid() and revoked_at is null
   limit 1;
  if dev.id is null then
    raise exception 'not a device account';
  end if;
  if not dev.movable then
    raise exception 'this device is not allowed to switch rooms';
  end if;
  if not exists (
    select 1 from public.rooms where id = new_room_id and team_id = dev.org_id
  ) then
    raise exception 'target room is not in this device''s org';
  end if;
  update public.org_devices set room_id = new_room_id where id = dev.id;
end;
$$;
revoke all on function public.set_device_room(uuid) from public, anon;
grant execute on function public.set_device_room(uuid) to authenticated;

-- Admin: reassign ANY device in the admin's org to any room in that org.
create or replace function public.admin_set_device_room(p_device_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.org_devices%rowtype;
begin
  select * into dev from public.org_devices where id = p_device_id and revoked_at is null;
  if dev.id is null then
    raise exception 'device not found';
  end if;
  if not exists (
    select 1 from public.team_members
     where team_id = dev.org_id and user_id = auth.uid()
       and (role = 'admin' or is_owner = true)
  ) then
    raise exception 'not an org admin';
  end if;
  if not exists (
    select 1 from public.rooms where id = p_room_id and team_id = dev.org_id
  ) then
    raise exception 'target room is not in this device''s org';
  end if;
  update public.org_devices set room_id = p_room_id where id = dev.id;
end;
$$;
revoke all on function public.admin_set_device_room(uuid, uuid) from public, anon;
grant execute on function public.admin_set_device_room(uuid, uuid) to authenticated;

-- Admin: toggle whether a device may self-switch rooms.
create or replace function public.admin_set_device_movable(p_device_id uuid, p_movable boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dev public.org_devices%rowtype;
begin
  select * into dev from public.org_devices where id = p_device_id and revoked_at is null;
  if dev.id is null then
    raise exception 'device not found';
  end if;
  if not exists (
    select 1 from public.team_members
     where team_id = dev.org_id and user_id = auth.uid()
       and (role = 'admin' or is_owner = true)
  ) then
    raise exception 'not an org admin';
  end if;
  update public.org_devices set movable = p_movable where id = dev.id;
end;
$$;
revoke all on function public.admin_set_device_movable(uuid, boolean) from public, anon;
grant execute on function public.admin_set_device_movable(uuid, boolean) to authenticated;
