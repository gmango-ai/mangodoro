-- Rename helper: admins direct-write; leads + creators need this RPC
-- because the policy rewrite in 20260613150000 locked direct writes
-- to org admins only.

create or replace function public.rename_room(
  p_room_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_clean text := trim(p_name);
begin
  if v_clean = '' then
    raise exception 'Room name is required';
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
    raise exception 'You do not have permission to rename this room';
  end if;

  update public.rooms set name = v_clean where id = p_room_id;
end;
$$;

grant execute on function public.rename_room(uuid, text) to authenticated;

notify pgrst, 'reload schema';
