-- Full org roster for a kiosk display: everyone's identity + status + location.
--
-- The "Who's here" kiosk panel only showed this room's session participants. A
-- communal display wants the WHOLE team with where each person is. A device
-- can't read org-wide user_presence / profiles under its least-privilege RLS,
-- and we deliberately DON'T broaden the `rooms` SELECT policy (the movable-device
-- room switcher detects movability by "can I read >1 room", so widening it would
-- make every fixed device look movable). So expose the roster as ONE
-- security-definer RPC instead, gated to the calling device's own org.
--
-- Returns raw presence fields so the client reuses its existing merge/liveness
-- logic (mergeOfficePresence): a member with no presence row comes back as
-- offline/no-location via the LEFT JOINs. Only a real device (is_device_user)
-- gets rows, and only for its org (current_device_org) — a non-device gets none.

create or replace function public.device_team_roster()
returns table (
  user_id               uuid,
  display_name          text,
  avatar_url            text,
  availability          text,
  override_availability text,
  override_expires_at   timestamptz,
  activity_label        text,
  activity_private      boolean,
  invisible             boolean,
  location_kind         text,
  location_room_id      uuid,
  room_name             text,
  last_seen_at          timestamptz,
  since                 timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.user_id,
    coalesce(pr.display_name, '') as display_name,
    coalesce(pr.avatar_url, '')   as avatar_url,
    up.availability,
    up.override_availability,
    up.override_expires_at,
    up.activity_label,
    up.activity_private,
    up.invisible,
    up.location_kind,
    up.location_room_id,
    r.name as room_name,
    up.last_seen_at,
    up.since
  from public.team_members tm
  left join public.profiles pr      on pr.user_id = tm.user_id
  left join public.user_presence up on up.user_id = tm.user_id
  left join public.rooms r          on r.id = up.location_room_id
  where public.is_device_user()
    and tm.team_id = public.current_device_org();
$$;

grant execute on function public.device_team_roster() to authenticated;
