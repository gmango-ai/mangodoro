-- Reflow overlapping rooms + bump default size to 4×2.
--
-- Two problems landed after PR B + PR #36:
--   1. The 3×2 default was still cramped; user feedback was that the
--      tile only "looks good" at 4×2 — at that size the room name +
--      kind label + occupant strip + Start button all read cleanly.
--   2. Backfill in #36 widened 2×2 → 3×2 without touching positions,
--      so rooms that didn't collide at 2×2 may now overlap at 3×2.
--      Same risk happens again going to 4×2.
--
-- This migration auto-places every still-default-sized room into a
-- clean 3-per-row 4×2 grid by created_at order. Rooms that have been
-- manually sized to anything other than the prior default are
-- considered "user-positioned" and left alone — we don't want to
-- stomp on a layout someone deliberately built.

alter table public.rooms
  alter column layout_w set default 4,
  alter column layout_h set default 2;

-- A room is "still at default" if its current (w,h) matches either
-- the original (2,2) or the post-#36 (3,2). Resize to (4,2) and
-- reassign positions in a 3-per-row sweep.
with to_reflow as (
  select
    id,
    team_id,
    (row_number() over (partition by team_id order by created_at, id) - 1) as ord
  from public.rooms
  where archived_at is null
    and (
      (layout_w = 2 and layout_h = 2) or
      (layout_w = 3 and layout_h = 2)
    )
)
update public.rooms r
set
  layout_w = 4,
  layout_h = 2,
  layout_x = (t.ord % 3) * 4,
  layout_y = (t.ord / 3) * 2
from to_reflow t
where r.id = t.id;

-- Bump create_room_v2 defaults too.
create or replace function public.create_room_v2(
  p_team_id uuid,
  p_name text,
  p_kind text,
  p_org_team_ids uuid[] default array[]::uuid[],
  p_invite_code text default null,
  p_layout_x int default 0,
  p_layout_y int default 0,
  p_layout_w int default 4,
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

  select bool_or(role = 'admin'), bool_or(true)
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
      select 1 from unnest(v_gating) as t(id)
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
