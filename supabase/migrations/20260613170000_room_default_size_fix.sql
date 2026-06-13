-- Fix default room size on the floor plan.
--
-- 2×2 cells (the original default) is too narrow for the room tile
-- content — at 12 columns wide, that's ~16% of the container, which
-- truncates the room name and stacks "DEPARTMENT / Nobody here / Start"
-- in a way that looks broken. 3×2 fits the content comfortably and
-- yields a sensible 4-per-row grid.
--
-- We bump the column DEFAULTs (affects new rows) and backfill any
-- existing room that's still at the previous default (2×2) so users
-- don't have to manually resize each tile after upgrading.

alter table public.rooms
  alter column layout_w set default 3,
  alter column layout_h set default 2;

update public.rooms
set layout_w = 3, layout_h = 2
where layout_w = 2 and layout_h = 2;

-- Update create_room_v2 to reflect the same new defaults.
create or replace function public.create_room_v2(
  p_team_id uuid,
  p_name text,
  p_kind text,
  p_org_team_ids uuid[] default array[]::uuid[],
  p_invite_code text default null,
  p_layout_x int default 0,
  p_layout_y int default 0,
  p_layout_w int default 3,
  p_layout_h int default 2
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_is_member boolean;
  v_kind public.room_kind := p_kind::public.room_kind;
  v_room_id uuid;
  v_clean_name text := trim(p_name);
  v_gating uuid[] := coalesce(p_org_team_ids, array[]::uuid[]);
begin
  if v_clean_name = '' then
    raise exception 'Room name is required';
  end if;

  select
    bool_or(role = 'admin'),
    bool_or(true)
  into v_is_admin, v_is_member
  from public.team_members
  where team_id = p_team_id and user_id = auth.uid();

  if not coalesce(v_is_member, false) then
    raise exception 'You must be a member of this org to create a room';
  end if;

  if v_kind = 'department' and not v_is_admin then
    raise exception 'Only org admins can create department rooms';
  end if;

  if not v_is_admin and array_length(v_gating, 1) is not null then
    if exists (
      select 1
      from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_team_members
        where org_team_id = t.id and user_id = auth.uid() and role = 'lead'
      )
    ) then
      raise exception 'You may only gate a room to teams you lead';
    end if;
  end if;

  if array_length(v_gating, 1) is not null then
    if exists (
      select 1 from unnest(v_gating) as t(id)
      where not exists (
        select 1 from public.org_teams
        where id = t.id and org_id = p_team_id and archived_at is null
      )
    ) then
      raise exception 'A gating team does not belong to this org';
    end if;
  end if;

  insert into public.rooms
    (team_id, name, kind, invite_code, created_by,
     layout_x, layout_y, layout_w, layout_h)
  values
    (p_team_id, v_clean_name, v_kind, p_invite_code, auth.uid(),
     greatest(0, least(24, p_layout_x)),
     greatest(0, least(24, p_layout_y)),
     greatest(1, least(12, p_layout_w)),
     greatest(1, least(12, p_layout_h)))
  returning id into v_room_id;

  if array_length(v_gating, 1) is not null then
    insert into public.room_teams (room_id, org_team_id)
    select v_room_id, t.id from unnest(v_gating) as t(id);
  end if;

  return v_room_id;
end;
$$;

grant execute on function public.create_room_v2(uuid, text, text, uuid[], text, int, int, int, int) to authenticated;

notify pgrst, 'reload schema';
