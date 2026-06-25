-- Device kiosk read-only access to room chat + the room's linked whiteboard.
--
-- A "device account" (see 20260623130000_org_device_accounts.sql) is an auth user
-- with NO team_members row; its read access comes only from additive SELECT
-- policies keyed on public.current_device_room() (security-definer, returns the
-- device's pinned room_id or null for non-devices). These two policies extend
-- that pattern so a paired kiosk can show the room's chat + whiteboard panels.
--
-- SELECT-only, deliberately: no INSERT/UPDATE policies are added for devices, so
-- a kiosk can VIEW chat + whiteboard but never write — RLS denies any device
-- mutation by default, keeping the kiosk read-only.

-- Room chat: a device sees its pinned room's messages (and nothing else).
drop policy if exists "device reads its room chat" on public.chat_messages;
create policy "device reads its room chat"
  on public.chat_messages for select
  using (room_id = public.current_device_room());

-- Chat author profiles: hydrateAuthors / fetchAuthorProfile read name +
-- avatar_url from user_settings after loading messages; devices have no
-- team_members row, so grant SELECT only for users who posted in this room.
drop policy if exists "device reads room chat authors" on public.user_settings;
create policy "device reads room chat authors"
  on public.user_settings for select
  using (
    user_id in (
      select distinct user_id
        from public.chat_messages
       where room_id = public.current_device_room()
    )
  );

-- Whiteboard: a device sees only the whiteboard currently linked to its room's
-- active session (sync_sessions.whiteboard_id) — not every board in the org.
drop policy if exists "device reads its room whiteboard" on public.whiteboards;
create policy "device reads its room whiteboard"
  on public.whiteboards for select
  using (
    id in (
      select whiteboard_id
        from public.sync_sessions
       where room_id = public.current_device_room()
         and status = 'active'
         and whiteboard_id is not null
    )
  );
