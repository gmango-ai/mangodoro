-- Notification authorization + correctness hardening.
--   #2 emit_notification was granted to clients → anyone could insert arbitrary
--      spoofed notifications for anyone. Lock it to triggers; give clients two
--      narrow RPCs (self-nudge, mention) that force recipient/actor/type.
--   #3 notification_follows let you follow ANY user id → cross-org tracking.
--   #4 "back from lunch" only fired on → 'active'.
--   #8 lunch_reminder dedupe was read-then-write (racy across devices).

-- ── #8: make lunch_reminder dedupe a hard guarantee ──────────
-- Drop any pre-existing duplicate lunch rows, then a partial unique index.
delete from public.notifications a
 using public.notifications b
 where a.type = 'lunch_reminder' and b.type = 'lunch_reminder'
   and a.dedupe_key is not null and a.dedupe_key = b.dedupe_key
   and a.recipient_user_id = b.recipient_user_id
   and a.ctid > b.ctid;

create unique index if not exists notifications_lunch_dedupe_uniq
  on public.notifications (recipient_user_id, dedupe_key)
  where type = 'lunch_reminder' and dedupe_key is not null;

-- emit_notification gains an on-conflict for the lunch index (other types keep
-- their time-windowed dedupe, which intentionally reuses keys across windows).
create or replace function public.emit_notification(
  p_recipient uuid, p_type text, p_title text, p_body text default null,
  p_payload jsonb default '{}'::jsonb, p_actor uuid default null, p_team_id uuid default null,
  p_entity_type text default null, p_entity_id uuid default null,
  p_dedupe_key text default null, p_dedupe_window_minutes int default 60
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_enabled boolean; v_channels text[]; v_desktop_ok boolean; v_id uuid;
begin
  if p_actor is not null and p_actor = p_recipient then return null; end if;
  select np.enabled, np.channels into v_enabled, v_channels
    from public.notification_preferences np
   where np.user_id = p_recipient and np.type = p_type;
  if v_enabled is null then
    v_enabled := true; v_channels := public.notif_type_default_channels(p_type);
  end if;
  if not v_enabled then return null; end if;
  select coalesce(us.notif_desktop_enabled, true) into v_desktop_ok
    from public.user_settings us where us.user_id = p_recipient;
  if v_desktop_ok is distinct from true then v_channels := array_remove(v_channels, 'desktop'); end if;
  if v_channels is null or cardinality(v_channels) = 0 then v_channels := array['inapp']; end if;
  if p_dedupe_key is not null and exists (
    select 1 from public.notifications n
     where n.recipient_user_id = p_recipient and n.dedupe_key = p_dedupe_key
       and n.created_at > now() - make_interval(mins => p_dedupe_window_minutes)
  ) then return null; end if;
  insert into public.notifications
    (recipient_user_id, type, title, body, payload, actor_user_id, team_id, entity_type, entity_id, channels, dedupe_key)
  values
    (p_recipient, p_type, p_title, p_body, coalesce(p_payload, '{}'::jsonb), p_actor, p_team_id, p_entity_type, p_entity_id, v_channels, p_dedupe_key)
  on conflict (recipient_user_id, dedupe_key) where type = 'lunch_reminder' and dedupe_key is not null
  do nothing
  returning id into v_id;
  return v_id;
end; $$;

-- ── #2: lock the generic emit to triggers; narrow client RPCs ──
revoke execute on function public.emit_notification(uuid, text, text, text, jsonb, uuid, uuid, text, uuid, text, int) from public;
revoke execute on function public.emit_notification(uuid, text, text, text, jsonb, uuid, uuid, text, uuid, text, int) from authenticated;

-- Self-nudge: recipient/actor are forced; type restricted to a self allowlist.
create or replace function public.emit_self_notification(
  p_type text, p_title text, p_body text default null, p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null, p_dedupe_window_minutes int default 60
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_type not in ('lunch_reminder', 'reminder_daily') then
    raise exception 'Not a self-notifiable type';
  end if;
  return public.emit_notification(
    auth.uid(), p_type, p_title, p_body, coalesce(p_payload, '{}'::jsonb),
    null, null, null, null, p_dedupe_key, p_dedupe_window_minutes);
end; $$;
grant execute on function public.emit_self_notification(text, text, text, jsonb, text, int) to authenticated;

-- Mention: type/actor forced; recipient must share a team with the caller.
create or replace function public.emit_mention(
  p_recipient uuid, p_title text, p_body text default null, p_payload jsonb default '{}'::jsonb,
  p_entity_type text default null, p_entity_id uuid default null, p_dedupe_key text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.team_members me
    join public.team_members them on them.team_id = me.team_id
    where me.user_id = auth.uid() and them.user_id = p_recipient
  ) then
    raise exception 'Cannot mention a user outside your teams';
  end if;
  return public.emit_notification(
    p_recipient, 'mention', p_title, p_body, coalesce(p_payload, '{}'::jsonb),
    auth.uid(), null, p_entity_type, p_entity_id, p_dedupe_key, 5);
end; $$;
grant execute on function public.emit_mention(uuid, text, text, jsonb, text, uuid, text) to authenticated;

-- ── #3: a follow's target must share a team with the follower ──
drop policy if exists "follower manages own follows" on public.notification_follows;
create policy "follower manages own follows" on public.notification_follows
  for all
  using (follower_user_id = auth.uid())
  with check (
    follower_user_id = auth.uid()
    and target_user_id in (
      select tm2.user_id from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
      where tm1.user_id = auth.uid()
    )
  );

-- ── #4: "back from lunch" should fire on leaving out_to_lunch for ANY state ──
create or replace function public.tg_lunch_return()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record; v_name text; v_payload jsonb;
begin
  if not (old.presence_state = 'out_to_lunch' and new.presence_state <> 'out_to_lunch') then
    return new;
  end if;

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
          where tm1.user_id = new.user_id
       )
  loop
    perform public.emit_notification(
      r.follower_user_id, 'lunch_return', v_name || ' is back from lunch', null, v_payload,
      new.user_id, null, 'user', new.user_id,
      'lunch_return:' || new.user_id::text || ':' || r.follower_user_id::text, 120);
  end loop;

  return new;
end; $$;

notify pgrst, 'reload schema';
