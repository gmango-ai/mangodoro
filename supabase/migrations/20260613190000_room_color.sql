-- Per-room accent color.
--
-- Lets admins/leads color-code rooms so the floor plan reads at a
-- glance (e.g. blue for engineering rooms, amber for design, teal for
-- meeting rooms). Mirrors the color field already on org_teams +
-- teams so the UI patterns line up.

alter table public.rooms
  add column if not exists color text not null default '#14b8a6';

-- Single-field RPC for changing color (mirrors rename_room). Admin
-- direct-writes also work via the existing "Org admins can directly
-- write rooms" policy.
create or replace function public.set_room_color(
  p_room_id uuid,
  p_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  if p_color is null or trim(p_color) = '' then
    raise exception 'Color is required';
  end if;
  select created_by into v_creator from public.rooms where id = p_room_id;
  if v_creator is null then
    raise exception 'Room not found';
  end if;
  if not (
    public.is_org_admin_of_room(p_room_id)
    or public.is_lead_of_any_gating_team(p_room_id)
    or v_creator = auth.uid()
  ) then
    raise exception 'You do not have permission to recolor this room';
  end if;
  update public.rooms set color = p_color where id = p_room_id;
end;
$$;

grant execute on function public.set_room_color(uuid, text) to authenticated;

-- Drop and recreate create_room_v2 to add p_color. Default keeps the
-- column default's teal accent. We have to drop because the signature
-- (param count) changes.
drop function if exists public.create_room_v2(uuid, text, text, uuid[], text, int, int, int, int);

create or replace function public.create_room_v2(
  p_team_id uuid,
  p_name text,
  p_kind text,
  p_org_team_ids uuid[] default array[]::uuid[],
  p_invite_code text default null,
  p_layout_x int default 0,
  p_layout_y int default 0,
  p_layout_w int default 4,
  p_layout_h int default 2,
  p_color text default '#14b8a6'
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
    (team_id, name, kind, invite_code, created_by, color,
     layout_x, layout_y, layout_w, layout_h)
  values
    (p_team_id, v_clean_name, v_kind, p_invite_code, auth.uid(), coalesce(p_color, '#14b8a6'),
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

grant execute on function public.create_room_v2(uuid, text, text, uuid[], text, int, int, int, int, text) to authenticated;

notify pgrst, 'reload schema';
