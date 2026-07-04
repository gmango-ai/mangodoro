-- Notification pipeline rebuild — Phase 1a (behavior-preserving, additive).
-- See docs/plans/status-notification-integration.md §7.
--
-- Splits the conflated bus into events + per-recipient deliveries, adds a
-- priority dimension and focus-aware routing. This lands as a SHADOW: the live
-- `notifications` table + `emit_notification` RPC are LEFT UNTOUCHED (the app
-- keeps reading them, so behavior is identical). A defensive AFTER-INSERT
-- trigger mirrors each notification into the new schema so it accumulates in
-- parallel. Cutover (client reads deliveries + applies the delivery policy +
-- web-push) is a later, tested step; emit_event is the entry point emitters
-- switch to then (dropping the mirror trigger).

-- ── notification_events (one row per thing that happened) ─────
create table if not exists public.notification_events (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  team_id       uuid references public.teams(id) on delete cascade,
  type          text not null,
  priority      text not null default 'normal'
                  check (priority in ('low','normal','high','urgent')),
  title         text not null,
  body          text,
  payload       jsonb not null default '{}'::jsonb,
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text,
  created_at    timestamptz not null default now()
);

-- ── notification_deliveries (one per recipient; self-contained) ──
-- Denormalized display fields so the client reads deliveries alone (same shape
-- as the old `notifications` row) — no join needed on the hot path.
create table if not exists public.notification_deliveries (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid references public.notification_events(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type              text not null,
  priority          text not null default 'normal'
                      check (priority in ('low','normal','high','urgent')),
  title             text not null,
  body              text,
  payload           jsonb not null default '{}'::jsonb,
  actor_user_id     uuid references auth.users(id) on delete set null,
  team_id           uuid references public.teams(id) on delete cascade,
  entity_type       text,
  entity_id         uuid,
  channels          text[] not null default '{inapp}',
  state             text not null default 'delivered'
                      check (state in ('delivered','held','read','dismissed')),
  held_reason       text,
  dedupe_key        text,
  read_at           timestamptz,
  delivered_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists nd_recipient_recent
  on public.notification_deliveries (recipient_user_id, created_at desc);
create index if not exists nd_recipient_unread
  on public.notification_deliveries (recipient_user_id, created_at desc)
  where read_at is null;
create index if not exists nd_dedupe_lookup
  on public.notification_deliveries (recipient_user_id, dedupe_key, created_at desc)
  where dedupe_key is not null;

alter table public.notification_deliveries replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.notification_deliveries;
exception when duplicate_object then null; end $$;

alter table public.notification_deliveries enable row level security;
-- Recipient reads / updates own (read_at, dismiss). No client INSERT — all go
-- through the security-definer emit path.
drop policy if exists "recipient reads own deliveries" on public.notification_deliveries;
create policy "recipient reads own deliveries"
  on public.notification_deliveries for select
  using (recipient_user_id = auth.uid());
drop policy if exists "recipient updates own deliveries" on public.notification_deliveries;
create policy "recipient updates own deliveries"
  on public.notification_deliveries for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- ── per-type priority defaults (mirrors notif_type_default_channels) ──
create or replace function public.notif_type_default_priority(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'knock'          then 'high'
    when 'mention'        then 'high'
    when 'dm'             then 'high'
    when 'channel'        then 'normal'
    when 'lunch_reminder' then 'normal'
    when 'reminder_daily' then 'normal'
    when 'follow_focus'   then 'normal'
    when 'session_started' then 'low'
    when 'lunch_start'    then 'low'
    when 'lunch_return'   then 'low'
    when 'room_joined'    then 'low'
    when 'reminder'       then 'low'
    else 'normal'
  end;
$$;

-- ── delivery insert + focus-aware routing (shared) ───────────
-- Reads the recipient's resolved availability (user_presence) and, while they're
-- focusing / in a meeting, HOLDS low/normal items (no desktop push; queued for a
-- return digest). Defensive: no presence row → treated as available.
create or replace function public._nd_insert_delivery(
  p_event_id uuid, p_recipient uuid, p_type text, p_priority text,
  p_title text, p_body text, p_payload jsonb, p_actor uuid, p_team_id uuid,
  p_entity_type text, p_entity_id uuid, p_channels text[], p_dedupe_key text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_avail       text;
  v_state       text := 'delivered';
  v_held_reason text;
  v_channels    text[] := coalesce(p_channels, array['inapp']);
  v_id          uuid;
begin
  select up.availability into v_avail
    from public.user_presence up where up.user_id = p_recipient;
  v_avail := coalesce(v_avail, 'available');

  if v_avail in ('focusing','in_meeting') and p_priority in ('low','normal') then
    v_state := 'held';
    v_held_reason := 'focus';
    v_channels := pg_catalog.array_remove(v_channels, 'desktop');
  end if;
  if v_channels is null or pg_catalog.cardinality(v_channels) = 0 then
    v_channels := array['inapp'];
  end if;

  insert into public.notification_deliveries
    (event_id, recipient_user_id, type, priority, title, body, payload,
     actor_user_id, team_id, entity_type, entity_id, channels, state, held_reason, dedupe_key)
  values
    (p_event_id, p_recipient, p_type, p_priority, p_title, p_body,
     coalesce(p_payload, '{}'::jsonb), p_actor, p_team_id, p_entity_type,
     p_entity_id, v_channels, v_state, v_held_reason, p_dedupe_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── emit_event — the future single entry point (post-cutover) ──
-- Same shape as emit_notification, plus p_priority. Creates one event + one
-- delivery (routing applied). Emitters switch to this at cutover.
create or replace function public.emit_event(
  p_recipient   uuid,
  p_type        text,
  p_title       text,
  p_body        text default null,
  p_payload     jsonb default '{}'::jsonb,
  p_actor       uuid default null,
  p_team_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_priority    text default null,
  p_dedupe_key  text default null,
  p_dedupe_window_minutes int default 60
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_enabled  boolean;
  v_channels text[];
  v_desktop_ok boolean;
  v_priority text;
  v_event_id uuid;
begin
  if p_actor is not null and p_actor = p_recipient then return null; end if;

  select np.enabled, np.channels into v_enabled, v_channels
    from public.notification_preferences np
   where np.user_id = p_recipient and np.type = p_type;
  if v_enabled is null then
    v_enabled := true;
    v_channels := public.notif_type_default_channels(p_type);
  end if;
  if not v_enabled then return null; end if;

  select coalesce(us.notif_desktop_enabled, true) into v_desktop_ok
    from public.user_settings us where us.user_id = p_recipient;
  if v_desktop_ok is distinct from true then
    v_channels := pg_catalog.array_remove(v_channels, 'desktop');
  end if;

  v_priority := coalesce(p_priority, public.notif_type_default_priority(p_type));

  if p_dedupe_key is not null and exists (
    select 1 from public.notification_deliveries d
     where d.recipient_user_id = p_recipient
       and d.dedupe_key = p_dedupe_key
       and d.created_at > now() - pg_catalog.make_interval(mins => p_dedupe_window_minutes)
  ) then
    return null;
  end if;

  insert into public.notification_events
    (actor_user_id, team_id, type, priority, title, body, payload, entity_type, entity_id, dedupe_key)
  values
    (p_actor, p_team_id, p_type, v_priority, p_title, p_body,
     coalesce(p_payload, '{}'::jsonb), p_entity_type, p_entity_id, p_dedupe_key)
  returning id into v_event_id;

  return public._nd_insert_delivery(v_event_id, p_recipient, p_type, v_priority,
    p_title, p_body, p_payload, p_actor, p_team_id, p_entity_type, p_entity_id,
    v_channels, p_dedupe_key);
end;
$$;

grant execute on function public.emit_event(
  uuid, text, text, text, jsonb, uuid, uuid, text, uuid, text, text, int
) to authenticated;

-- ── shadow mirror: old notifications → new schema ────────────
-- Behavior-preserving: emit_notification and every emitter are untouched; this
-- AFTER-INSERT trigger reflects each notification into an event + delivery.
-- Fully defensive — a mirror failure NEVER breaks the real insert.
create or replace function public.tg_notifications_mirror()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_priority text;
  v_event_id uuid;
begin
  v_priority := public.notif_type_default_priority(new.type);
  insert into public.notification_events
    (actor_user_id, team_id, type, priority, title, body, payload, entity_type, entity_id, dedupe_key, created_at)
  values
    (new.actor_user_id, new.team_id, new.type, v_priority, new.title, new.body,
     new.payload, new.entity_type, new.entity_id, new.dedupe_key, new.created_at)
  returning id into v_event_id;

  perform public._nd_insert_delivery(v_event_id, new.recipient_user_id, new.type,
    v_priority, new.title, new.body, new.payload, new.actor_user_id, new.team_id,
    new.entity_type, new.entity_id, new.channels, new.dedupe_key);
  return new;
exception when others then
  return new; -- shadow only; never break the live notification insert
end;
$$;

drop trigger if exists tr_notifications_mirror on public.notifications;
create trigger tr_notifications_mirror
  after insert on public.notifications
  for each row execute function public.tg_notifications_mirror();

notify pgrst, 'reload schema';
