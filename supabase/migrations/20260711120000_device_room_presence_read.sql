-- Device kiosk read-only access to the presence/status of its room's occupants.
--
-- A "device account" (see 20260623130000_org_device_accounts.sql) has NO
-- team_members row, so the existing "read own or teammates user_presence" SELECT
-- policy grants it nothing — the kiosk's "Who's here" panel can only show a flat
-- participant list with no availability/status. This adds one additive,
-- SELECT-only policy so a paired kiosk can read the 7-state availability +
-- activity + status-override of the people CURRENTLY IN its pinned room, keyed on
-- public.current_device_room() (security-definer; returns the device's live
-- room_id, or null for non-devices — for whom this policy therefore grants
-- nothing, and location_room_id = null is never true regardless).
--
-- Least-privilege: a device sees presence rows ONLY for users whose current
-- location is its room (location_room_id); it sees no other org presence. No
-- INSERT/UPDATE policy is added, so the kiosk stays read-only (RLS denies any
-- device write by default). For a MOVABLE device (see 20260625130000), the RLS
-- anchor reads the live org_devices.room_id, so the scope re-points automatically
-- when the device is reassigned to another room.

drop policy if exists "device reads its room presence" on public.user_presence;
create policy "device reads its room presence"
  on public.user_presence for select
  using (location_room_id = public.current_device_room());
