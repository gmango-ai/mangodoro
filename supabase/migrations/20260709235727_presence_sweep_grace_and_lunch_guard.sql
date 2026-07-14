-- Presence liveness alignment with the read-side model (mergeOfficePresence):
--  1) The sweep now waits 5 minutes (ONLINE_GRACE) before flipping a stale row
--     to 'offline', instead of 90s. Background tabs throttle their heartbeat, so
--     90s was demoting people who are actually at their PC (and stripping their
--     Focusing/Meeting DND). The roster computes Away (<12h) / Offline (>=12h)
--     from last_seen_at at read time; this just keeps the stored row from going
--     offline prematurely.
--  2) The lunch-transition notifications now fire ONLY for a live client (fresh
--     heartbeat). Otherwise the sweep flipping a lunching-but-closed tab off
--     'lunch' would send a bogus "back from lunch".
-- (Applied live via MCP; this file is the repo record.)

create or replace function public.sweep_presence()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- No heartbeat within the online grace → offline. (Read-side still shows Away
  -- for the first 12h; this is the DB-authoritative value for server readers.)
  update public.user_presence
     set availability = 'offline', updated_at = now()
   where availability <> 'offline'
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');

  -- Expire manual overrides whose deadline passed.
  update public.user_presence
     set override_availability = null,
         override_message = null,
         override_emoji = null,
         override_expires_at = null,
         override_set_at = null,
         updated_at = now()
   where override_expires_at is not null
     and override_expires_at < now();

  -- Expire auto-state pins ("keep my status") once their day is up.
  update public.user_presence
     set auto_pin_until = null, updated_at = now()
   where auto_pin_until is not null
     and auto_pin_until < now();
end;
$fn$;

-- Lunch notifications: only when the person is actually live (fresh heartbeat),
-- so a sweep-induced lunch->offline transition can't fire a phantom "back".
create or replace function public.tg_up_lunch_start()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record; v_name text; v_payload jsonb;
begin
  if not (coalesce(old.availability, '') <> 'lunch' and new.availability = 'lunch') then
    return new;
  end if;
  if coalesce(new.invisible, false) then return new; end if;
  if new.last_seen_at is null or new.last_seen_at < now() - interval '2 minutes' then return new; end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.user_id;
  v_name := coalesce(v_name, 'A teammate');
  v_payload := jsonb_build_object('user_id', new.user_id, 'route', '/office');

  for r in
    select distinct tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
     where tm1.user_id = new.user_id and tm2.user_id <> new.user_id
  loop
    perform public.emit_notification(
      r.user_id, 'lunch_start', v_name || ' went to lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_start:' || new.user_id::text || ':' || r.user_id::text, 120);
  end loop;

  for r in
    select f.follower_user_id
      from public.notification_follows f
     where f.target_user_id = new.user_id and f.follower_user_id <> new.user_id
       and f.follower_user_id not in (
         select distinct tm2.user_id
           from public.team_members tm1
           join public.team_members tm2 on tm2.team_id = tm1.team_id
          where tm1.user_id = new.user_id)
  loop
    perform public.emit_notification(
      r.follower_user_id, 'lunch_start', v_name || ' went to lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_start:' || new.user_id::text || ':' || r.follower_user_id::text, 120);
  end loop;

  return new;
end;
$function$;

create or replace function public.tg_up_lunch_return()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record; v_name text; v_payload jsonb;
begin
  if not (coalesce(old.availability, '') = 'lunch' and new.availability <> 'lunch') then
    return new;
  end if;
  if coalesce(new.invisible, false) then return new; end if;
  if new.last_seen_at is null or new.last_seen_at < now() - interval '2 minutes' then return new; end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.user_id;
  v_name := coalesce(v_name, 'A teammate');
  v_payload := jsonb_build_object('user_id', new.user_id, 'route', '/office');

  for r in
    select distinct tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
     where tm1.user_id = new.user_id and tm2.user_id <> new.user_id
  loop
    perform public.emit_notification(
      r.user_id, 'lunch_return', v_name || ' is back from lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_return:' || new.user_id::text || ':' || r.user_id::text, 120);
  end loop;

  for r in
    select f.follower_user_id
      from public.notification_follows f
     where f.target_user_id = new.user_id and f.follower_user_id <> new.user_id
       and f.follower_user_id not in (
         select distinct tm2.user_id
           from public.team_members tm1
           join public.team_members tm2 on tm2.team_id = tm1.team_id
          where tm1.user_id = new.user_id)
  loop
    perform public.emit_notification(
      r.follower_user_id, 'lunch_return', v_name || ' is back from lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_return:' || new.user_id::text || ':' || r.follower_user_id::text, 120);
  end loop;

  return new;
end;
$function$;
