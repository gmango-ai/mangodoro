-- Lunch notifications: a "went to lunch" awareness ping (mirrors lunch_return)
-- plus a personal "lunch_reminder" self-nudge type the client emits at the
-- user's scheduled lunch time (routed through the layer = inbox + desktop +
-- prefs/quiet-hours, replacing LunchReminder's ad-hoc browser Notification).

-- Default channels for the new types. lunch_start is low-noise awareness
-- (inapp-only, like lunch_return); lunch_reminder is a personal nudge (desktop).
create or replace function public.notif_type_default_channels(p_type text)
returns text[] language sql immutable as $$
  select case p_type
    when 'room_joined'    then array['inapp']
    when 'lunch_return'   then array['inapp']
    when 'lunch_start'    then array['inapp']
    when 'lunch_reminder' then array['inapp', 'desktop']
    else array['inapp', 'desktop']
  end;
$$;

-- ── lunch_start: presence (anything) → out_to_lunch ──────────
create or replace function public.tg_lunch_start()
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
  if not (coalesce(old.presence_state, '') <> 'out_to_lunch' and new.presence_state = 'out_to_lunch') then
    return new;
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.user_id;
  v_name := coalesce(v_name, 'A teammate');
  v_payload := jsonb_build_object('user_id', new.user_id, 'route', '/office');

  -- Teammates (anyone sharing a team with the person going to lunch).
  for r in
    select distinct tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
     where tm1.user_id = new.user_id and tm2.user_id <> new.user_id
  loop
    perform public.emit_notification(
      r.user_id, 'lunch_start', v_name || ' went to lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_start:' || new.user_id::text || ':' || r.user_id::text, 120
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
      r.follower_user_id, 'lunch_start', v_name || ' went to lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_start:' || new.user_id::text || ':' || r.follower_user_id::text, 120
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists tr_lunch_start on public.user_settings;
create trigger tr_lunch_start
  after update on public.user_settings
  for each row
  when (old.presence_state is distinct from new.presence_state)
  execute function public.tg_lunch_start();

notify pgrst, 'reload schema';
