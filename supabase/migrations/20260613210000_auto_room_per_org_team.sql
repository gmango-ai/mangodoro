-- Auto-create a department room when an org_team is created.
--
-- Today an admin spins up the team (e.g. "SWE") but still has to make
-- a corresponding room manually for the team to meet in. The team is
-- the unit of organization, the room is the unit of meeting — they
-- should land together. This trigger fires on org_team insert and
-- creates a same-named, same-colored department room gated to that
-- single team.
--
-- Idempotent for re-runs: skips if a non-archived room already exists
-- with that name in the org gated to that org_team. Admins can rename,
-- recolor, regate, or archive the room after the fact — the trigger
-- only seeds the initial state.

create or replace function public.create_default_room_for_org_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  -- If something with the same gating + name already exists, no-op.
  if exists (
    select 1
    from public.rooms r
    join public.room_teams rt on rt.room_id = r.id
    where r.team_id = new.org_id
      and r.archived_at is null
      and rt.org_team_id = new.id
      and r.name = new.name
  ) then
    return new;
  end if;

  insert into public.rooms
    (team_id, name, kind, created_by, color,
     layout_x, layout_y, layout_w, layout_h)
  values
    (new.org_id, new.name, 'department', new.created_by, coalesce(new.color, '#14b8a6'),
     0, 0, 4, 2)
  returning id into v_room_id;

  insert into public.room_teams (room_id, org_team_id)
  values (v_room_id, new.id);

  return new;
end;
$$;

drop trigger if exists tr_org_teams_create_default_room on public.org_teams;
create trigger tr_org_teams_create_default_room
  after insert on public.org_teams
  for each row
  execute function public.create_default_room_for_org_team();

notify pgrst, 'reload schema';
