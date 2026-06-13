-- Drop the auto-room-per-org_team trigger.
--
-- Shipped one migration ago (20260613210000), but the user wants
-- room creation to be opt-in instead of automatic — some teams are
-- descriptive groupings (Frontend, Backend within SWE) that share
-- the SWE room rather than needing their own. The checkbox lives on
-- the new team form; client-side code creates the room when checked.
--
-- Existing auto-created rooms stay; admins can archive them via the
-- /team Rooms list if they aren't wanted.

drop trigger if exists tr_org_teams_create_default_room on public.org_teams;
drop function if exists public.create_default_room_for_org_team();

notify pgrst, 'reload schema';
