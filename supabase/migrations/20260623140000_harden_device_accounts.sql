-- Harden device accounts: a device must stay a read-only, room-scoped kiosk and
-- never escalate into org membership or a pomodoro session.
--
-- IMPORTANT: user_metadata and user_settings.is_device are BOTH self-editable by
-- the device (auth.updateUser / "users update own"), so neither is safe for a
-- security decision. The authoritative source is org_devices, which is
-- service-role-write only — a device cannot flip its own flag there.

create or replace function public.is_device_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_devices
    where user_id = auth.uid() and revoked_at is null
  );
$$;
grant execute on function public.is_device_user() to authenticated;

-- Block device accounts from gaining org membership or joining a pomodoro
-- session via ANY path. RPCs run SECURITY DEFINER, but auth.uid() is still the
-- device, so a trigger catches every current and future RPC — unlike guarding
-- one function at a time. Service-role writes (auth.uid() is null) are never
-- blocked, so device-provision and admin flows are unaffected.
create or replace function public.reject_device_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_device_user() then
    raise exception 'Device accounts cannot perform this action';
  end if;
  return new;
end;
$$;

drop trigger if exists block_device_team_join on public.team_members;
create trigger block_device_team_join
  before insert on public.team_members
  for each row execute function public.reject_device_write();

drop trigger if exists block_device_session_join on public.sync_session_participants;
create trigger block_device_session_join
  before insert on public.sync_session_participants
  for each row execute function public.reject_device_write();

-- Belt-and-suspenders on the one escalation RPC (friendlier error than the
-- trigger, and explicit at the call site). Mirrors the existing guest guard.
create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_existing uuid;
begin
  if public.is_anonymous_auth() then
    raise exception 'Guests cannot join teams';
  end if;
  if public.is_device_user() then
    raise exception 'Device accounts cannot join teams';
  end if;

  select id into v_team_id from public.teams where invite_code = lower(code);
  if v_team_id is null then
    raise exception 'Invalid invite code';
  end if;

  select id into v_existing
  from public.team_members
  where team_id = v_team_id and user_id = auth.uid();
  if v_existing is not null then
    return v_team_id;
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, auth.uid(), 'member');

  return v_team_id;
end;
$$;

notify pgrst, 'reload schema';
