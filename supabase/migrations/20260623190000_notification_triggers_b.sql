-- Notification triggers — Stage B: "back from lunch" + "joined your room".
-- Same pattern as Stage A (security definer, set-based loop over recipients,
-- per-(actor,recipient) dedupe). Both types default to inapp-only (see the
-- registry) so they collect in the inbox without desktop pop-ups.

-- ── lunch_return: presence out_to_lunch → active ─────────────
create or replace function public.tg_lunch_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_name text;
  v_payload jsonb;
begin
  if not (old.presence_state = 'out_to_lunch' and new.presence_state = 'active') then
    return new;
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.user_id;
  v_name := coalesce(v_name, 'A teammate');
  v_payload := jsonb_build_object('user_id', new.user_id, 'route', '/office');

  -- Teammates (anyone sharing a team with the returner).
  for r in
    select distinct tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
     where tm1.user_id = new.user_id and tm2.user_id <> new.user_id
  loop
    perform public.emit_notification(
      r.user_id, 'lunch_return', v_name || ' is back from lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_return:' || new.user_id::text || ':' || r.user_id::text, 120
    );
  end loop;

  -- Followers who don't already share a team.
  for r in
    select f.follower_user_id
      from public.notification_follows f
     where f.target_user_id = new.user_id and f.follower_user_id <> new.user_id
       and f.follower_user_id not in (
         select distinct tm2.user_id
           from public.team_members tm1
           join public.team_members tm2 on tm2.team_id = tm1.team_id
          where tm1.user_id = new.user_id
       )
  loop
    perform public.emit_notification(
      r.follower_user_id, 'lunch_return', v_name || ' is back from lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_return:' || new.user_id::text || ':' || r.follower_user_id::text, 120
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists tr_lunch_return on public.user_settings;
create trigger tr_lunch_return
  after update on public.user_settings
  for each row
  when (old.presence_state is distinct from new.presence_state)
  execute function public.tg_lunch_return();

-- ── room_joined: a new participant in a room-scoped session ──
create or replace function public.tg_room_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_name text;
  v_room uuid;
  v_payload jsonb;
begin
  if new.left_at is not null then
    return new;
  end if;

  select s.room_id into v_room from public.sync_sessions s where s.id = new.session_id;
  if v_room is null then
    return new;  -- only room-scoped sessions raise a "joined the room" ping
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.user_id;
  v_name := coalesce(v_name, nullif(trim(coalesce(new.display_name, '')), ''), 'A teammate');
  v_payload := jsonb_build_object('room_id', v_room, 'session_id', new.session_id, 'route', '/office');

  -- Other live participants of any active session in the same room.
  for r in
    select distinct p.user_id
      from public.sync_session_participants p
      join public.sync_sessions s on s.id = p.session_id
     where s.room_id = v_room and p.left_at is null and p.user_id <> new.user_id
  loop
    perform public.emit_notification(
      r.user_id, 'room_joined', v_name || ' joined the room', null, v_payload,
      new.user_id, null, 'room', v_room,
      'room_joined:' || v_room::text || ':' || new.user_id::text || ':' || r.user_id::text, 15
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists tr_room_joined on public.sync_session_participants;
create trigger tr_room_joined
  after insert on public.sync_session_participants
  for each row
  execute function public.tg_room_joined();

notify pgrst, 'reload schema';
