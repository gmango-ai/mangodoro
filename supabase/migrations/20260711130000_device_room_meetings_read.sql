-- Device kiosk read-only access to its room's scheduled meetings.
--
-- A "device account" (see 20260623130000_org_device_accounts.sql) has NO
-- team_members row, so the existing team-scoped SELECT policy on
-- scheduled_meetings ("scheduled_meetings: team reads", is_team_member(team_id))
-- grants it nothing. This adds one additive, SELECT-only policy so a paired kiosk
-- can read the meetings scheduled IN its pinned room, keyed on
-- public.current_device_room() (security-definer; returns the device's live
-- room_id, or null for non-devices — for whom this grants nothing).
--
-- Least-privilege: a device sees only meetings whose room_id is its own room; no
-- other org meetings, and no write policy (the kiosk stays read-only). Powers the
-- kiosk "Meetings" panel + the imminent-meeting alert/chime. For a MOVABLE device
-- the anchor reads the live org_devices.room_id, so the scope re-points on
-- reassignment.

drop policy if exists "device reads its room meetings" on public.scheduled_meetings;
create policy "device reads its room meetings"
  on public.scheduled_meetings for select
  using (room_id = public.current_device_room());
