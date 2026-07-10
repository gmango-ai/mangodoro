-- Final status-system cleanup: retire the legacy presence_state vocabulary and
-- the sync-participant status/presence columns + their RPCs. Availability now
-- lives solely on user_presence (resolver), and the free-text status message on
-- user_settings.status. Lunch-transition notifications move onto user_presence.
-- (Applied live via MCP apply_migration on the shared DB; this file is the repo
-- record — see memory supabase-migrations-shared-db.)

-- 1) Recreate the member-profiles RPC without presence_state (changing the
--    output columns requires DROP + CREATE, not CREATE OR REPLACE).
drop function if exists public.get_team_member_profiles(uuid);
create function public.get_team_member_profiles(p_team_id uuid)
 returns table(user_id uuid, name text, avatar_url text, status text,
   status_updated_at timestamp with time zone, role text,
   joined_at timestamp with time zone, sticky_color text, classification text,
   hourly_rate numeric, weekly_target_hours numeric, manager_id uuid)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text     as name,
    coalesce(us.avatar_url, '')::text          as avatar_url,
    coalesce(us.status, '')::text              as status,
    us.status_updated_at,
    tm.role,
    tm.joined_at,
    coalesce(us.sticky_color, '#fde68a')::text as sticky_color,
    tm.classification,
    tm.hourly_rate,
    tm.weekly_target_hours,
    tm.manager_id
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
    and exists (
      select 1 from public.team_members tm2
      where tm2.team_id = p_team_id and tm2.user_id = auth.uid()
    )
  order by tm.joined_at asc;
$function$;

-- 2) status_updated_at now bumps on status-message change only.
create or replace function public.user_settings_touch_status()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := pg_catalog.now();
  end if;
  return new;
end;
$function$;

-- 3) Move lunch-transition notifications off user_settings.presence_state onto
--    the canonical user_presence.availability. Drop the old triggers/functions.
drop trigger if exists tr_lunch_start on public.user_settings;
drop trigger if exists tr_lunch_return on public.user_settings;
drop function if exists public.tg_lunch_start();
drop function if exists public.tg_lunch_return();

create function public.tg_up_lunch_start()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record; v_name text; v_payload jsonb;
begin
  -- Only the entry transition into lunch, and never while appearing offline.
  if not (coalesce(old.availability, '') <> 'lunch' and new.availability = 'lunch') then
    return new;
  end if;
  if coalesce(new.invisible, false) then return new; end if;

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

create function public.tg_up_lunch_return()
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

create trigger tr_up_lunch_start after update on public.user_presence
  for each row execute function public.tg_up_lunch_start();
create trigger tr_up_lunch_return after update on public.user_presence
  for each row execute function public.tg_up_lunch_return();

-- 4) Drop the legacy status-writing RPCs (both overloads of the sync one).
drop function if exists public.set_user_status(text, text);
drop function if exists public.set_sync_participant_status(uuid, text, text);
drop function if exists public.set_sync_participant_status(uuid, text);

-- 5) Drop the legacy columns (their CHECK constraints drop with them).
alter table public.user_settings            drop column if exists presence_state;
alter table public.sync_session_participants drop column if exists presence_state;
alter table public.sync_session_participants drop column if exists status;
