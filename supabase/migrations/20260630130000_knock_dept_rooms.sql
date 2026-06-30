-- Extend knock-to-enter to DEPARTMENT-gated rooms (the "Both" follow-up).
--
-- 20260630120000 shipped a code-room-only request_room_entry: its guard raised
-- "This room does not accept knocks" for any non-code room, so a member locked
-- out of a department room could never knock. This re-defines request_room_entry
-- and decide_room_entry so a knock also works when the caller is blocked by a
-- department gate, and so a manager (owner / org admin / gating-team lead) — not
-- only a live occupant — can answer (an empty department room has nobody in it).
--
-- Fresh timestamp: 20260630120000 is already recorded as applied, so editing it
-- in place is skipped by `db push`. This new version carries the upgrade.
-- can_enter_room / set_room_knock_enabled / the table are unchanged.

create or replace function public.request_room_entry(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room         public.rooms;
  v_name         text;
  v_payload      jsonb;
  v_req_id       uuid;
  v_dept_gated   boolean;
  v_dept_blocked boolean;
  v_occupied     boolean;
  v_code_blocked boolean;
  r              record;
begin
  if p_room_id is null then
    raise exception 'Room not found';
  end if;

  select * into v_room
    from public.rooms
    where id = p_room_id and archived_at is null;
  if v_room is null then
    raise exception 'Room not found';
  end if;

  -- Must belong to the room's org (matches the rooms SELECT policy / gate).
  if not exists (
    select 1 from public.team_members
    where team_id = v_room.team_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this room''s organization';
  end if;

  if v_room.knock_enabled is not true then
    raise exception 'This room does not accept knocks';
  end if;

  -- Managers can already walk in, so they never knock.
  if v_room.created_by = auth.uid()
     or public.is_org_admin_of_room(p_room_id)
     or public.is_lead_of_any_gating_team(p_room_id) then
    raise exception 'You can already enter this room';
  end if;

  -- Blocked by a department gate (room is gated and caller is in none of the
  -- gating teams)…
  v_dept_gated := exists (select 1 from public.room_teams rt where rt.room_id = p_room_id);
  v_dept_blocked := v_dept_gated and not exists (
    select 1 from public.room_teams rt
    join public.org_team_members otm on otm.org_team_id = rt.org_team_id
    where rt.room_id = p_room_id and otm.user_id = auth.uid()
  );

  -- …or by the code lock (a code room someone is already inside).
  select exists (
    select 1 from public.sync_sessions s
    join public.sync_session_participants p on p.session_id = s.id
    where s.room_id = p_room_id and s.status = 'active' and p.left_at is null
  ) into v_occupied;
  v_code_blocked := v_room.entry_policy = 'code' and v_occupied;

  if not (v_dept_blocked or v_code_blocked) then
    raise exception 'This room does not require a knock';
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = auth.uid();
  v_name := coalesce(v_name, 'Someone');

  -- One live pending row per (room, user); a repeat knock refreshes it.
  insert into public.room_knock_requests (room_id, user_id, display_name, status)
  values (p_room_id, auth.uid(), v_name, 'pending')
  on conflict (room_id, user_id) where status = 'pending'
    do update set created_at = pg_catalog.now(), display_name = excluded.display_name
  returning id into v_req_id;

  v_payload := jsonb_build_object(
    'room_id', p_room_id,
    'request_id', v_req_id,
    'route', '/office/r/' || p_room_id::text
  );

  -- Ping everyone who can let them in: live occupants + managers (owner, org
  -- admins, gating-team leads). In-app + desktop. emit_notification dedupes.
  for r in
    select distinct uid from (
      select p.user_id as uid
        from public.sync_session_participants p
        join public.sync_sessions s on s.id = p.session_id
       where s.room_id = p_room_id and s.status = 'active' and p.left_at is null
      union
      select v_room.created_by
      union
      select tm.user_id
        from public.team_members tm
       where tm.team_id = v_room.team_id and tm.role = 'admin'
      union
      select otm.user_id
        from public.org_team_members otm
        join public.room_teams rt on rt.org_team_id = otm.org_team_id
       where rt.room_id = p_room_id and otm.role = 'lead'
    ) recips
    where uid is not null and uid <> auth.uid()
  loop
    perform public.emit_notification(
      r.uid, 'knock', v_name || ' wants to join ' || v_room.name, null, v_payload,
      auth.uid(), v_room.team_id, 'room', p_room_id,
      'knock:' || p_room_id::text || ':' || auth.uid()::text || ':' || r.uid::text, 2
    );
  end loop;

  return v_req_id;
end;
$$;

grant execute on function public.request_room_entry(uuid) to authenticated;

create or replace function public.decide_room_entry(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.room_knock_requests;
begin
  select * into v_req
    from public.room_knock_requests
    where id = p_request_id;
  if v_req is null then
    raise exception 'Knock request not found';
  end if;

  -- A current live occupant OR a manager (owner / org admin / gating-team
  -- lead) may decide. Managers cover an empty department room with nobody in.
  if not (
    public.is_org_admin_of_room(v_req.room_id)
    or public.is_lead_of_any_gating_team(v_req.room_id)
    or exists (select 1 from public.rooms where id = v_req.room_id and created_by = auth.uid())
    or exists (
      select 1
      from public.sync_sessions s
      join public.sync_session_participants p on p.session_id = s.id
      where s.room_id = v_req.room_id
        and s.status = 'active'
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  ) then
    raise exception 'You are not allowed to answer this knock';
  end if;

  -- First decision wins; ignore re-decides on an already-resolved row.
  if v_req.status <> 'pending' then
    return;
  end if;

  update public.room_knock_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(),
         decided_at = pg_catalog.now()
   where id = p_request_id;
end;
$$;

grant execute on function public.decide_room_entry(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
