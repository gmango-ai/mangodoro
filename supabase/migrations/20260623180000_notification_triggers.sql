-- Notification triggers — Stage A: "a teammate started a focus session".
--
-- AFTER INSERT on sync_sessions fans out two awareness pings via
-- emit_notification (which applies each recipient's prefs + dedupe):
--   • session_started → everyone on the leader's team (per-type opt-out)
--   • follow_focus    → people who explicitly follow the leader and are NOT
--                       already covered by the team ping (e.g. cross-team)
--
-- Dedupe is keyed per (leader, recipient) within 30 min, so rapid
-- reset-on-empty session churn doesn't spam; a genuinely new session later
-- still pings. Security definer so it can read team_members + follows.

create or replace function public.tg_sync_session_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_name text;
  v_route text;
  v_payload jsonb;
begin
  -- Only genuinely active sessions.
  if new.status is distinct from 'active' then
    return new;
  end if;

  select nullif(trim(coalesce(us.name, '')), '') into v_name
    from public.user_settings us where us.user_id = new.leader_id;
  v_name := coalesce(v_name, 'A teammate');

  v_route := case when new.room_id is not null then '/office' else '/pomodoro' end;
  v_payload := jsonb_build_object(
    'session_id', new.id, 'room_id', new.room_id, 'route', v_route
  );

  -- Team awareness: everyone on the team except the leader.
  if new.team_id is not null then
    for r in
      select tm.user_id
        from public.team_members tm
       where tm.team_id = new.team_id
         and tm.user_id <> new.leader_id
    loop
      perform public.emit_notification(
        r.user_id, 'session_started',
        v_name || ' started a focus session', null, v_payload,
        new.leader_id, new.team_id, 'sync_session', new.id,
        'session_started:' || new.leader_id::text || ':' || r.user_id::text, 30
      );
    end loop;
  end if;

  -- Followers of the leader who are NOT on this team (team folks already pinged).
  for r in
    select f.follower_user_id
      from public.notification_follows f
     where f.target_user_id = new.leader_id
       and f.kind = 'focus_start'
       and f.follower_user_id <> new.leader_id
       and (
         new.team_id is null
         or f.follower_user_id not in (
           select tm.user_id from public.team_members tm where tm.team_id = new.team_id
         )
       )
  loop
    perform public.emit_notification(
      r.follower_user_id, 'follow_focus',
      v_name || ' is focusing', 'You asked to be notified.', v_payload,
      new.leader_id, new.team_id, 'sync_session', new.id,
      'follow_focus:' || new.leader_id::text || ':' || r.follower_user_id::text, 30
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists tr_sync_session_started on public.sync_sessions;
create trigger tr_sync_session_started
  after insert on public.sync_sessions
  for each row
  execute function public.tg_sync_session_started();

notify pgrst, 'reload schema';
