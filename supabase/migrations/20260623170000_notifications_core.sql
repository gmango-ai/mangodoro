-- Notification Layer — core platform.
--
-- A reusable delivery layer: one durable per-recipient `notifications` table
-- (which IS the event bus — insert → Realtime → clients), per-user preferences,
-- "follow" relationships, and a single `emit_notification` entry point that
-- every trigger / client / cron calls. Modeled on chat_messages (realtime +
-- RLS) and the user_settings prefs plumbing.
--
-- Channels: 'inapp' (always, the inbox), 'desktop' (browser Notification —
-- the client applies quiet-hours in local time before raising it). Native push
-- is a later sub-project and not a channel yet.

-- ── notifications (the bus) ──────────────────────────────────
create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type              text not null,
  title             text not null,
  body              text,
  payload           jsonb not null default '{}'::jsonb,
  actor_user_id     uuid references auth.users(id) on delete set null,
  team_id           uuid references public.teams(id) on delete cascade,
  entity_type       text,
  entity_id         uuid,
  channels          text[] not null default '{inapp}',
  dedupe_key        text,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists notifications_recipient_recent
  on public.notifications (recipient_user_id, created_at desc);
create index if not exists notifications_recipient_unread
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;
-- Supports the in-RPC dedupe lookup.
create index if not exists notifications_dedupe_lookup
  on public.notifications (recipient_user_id, dedupe_key, created_at desc)
  where dedupe_key is not null;

alter table public.notifications replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

alter table public.notifications enable row level security;

-- Recipient reads own rows. (No client INSERT — all inserts go through
-- emit_notification, which is security definer.)
drop policy if exists "recipient reads own notifications" on public.notifications;
create policy "recipient reads own notifications"
  on public.notifications for select
  using (recipient_user_id = auth.uid());

-- Recipient updates own rows (in practice only read_at).
drop policy if exists "recipient updates own notifications" on public.notifications;
create policy "recipient updates own notifications"
  on public.notifications for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- ── per-type preference overrides (sparse) ───────────────────
create table if not exists public.notification_preferences (
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  enabled    boolean not null default true,
  channels   text[] not null default '{inapp,desktop}',
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

alter table public.notification_preferences enable row level security;
drop policy if exists "owner manages own notif prefs" on public.notification_preferences;
create policy "owner manages own notif prefs"
  on public.notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── follows ("notify me when [X] starts focusing") ───────────
create table if not exists public.notification_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id   uuid not null references auth.users(id) on delete cascade,
  kind             text not null default 'focus_start',
  created_at       timestamptz not null default now(),
  primary key (follower_user_id, target_user_id, kind)
);

alter table public.notification_follows enable row level security;
-- The follower manages their own follow rows. Triggers read the target side via
-- the security-definer emit path (bypasses RLS).
drop policy if exists "follower manages own follows" on public.notification_follows;
create policy "follower manages own follows"
  on public.notification_follows for all
  using (follower_user_id = auth.uid())
  with check (follower_user_id = auth.uid());

-- ── global preference switches on user_settings ──────────────
-- (ride the existing clock:{userId} realtime sync + normalizeSettings plumbing)
alter table public.user_settings
  add column if not exists notif_quiet_start text,        -- 'HH:MM' (local, client-applied)
  add column if not exists notif_quiet_end   text,
  add column if not exists notif_desktop_enabled boolean not null default true;

-- ── type registry (defaults) ─────────────────────────────────
-- Mirrored in src/lib/notifications.js (NOTIFICATION_TYPES). All types default
-- enabled; the default channel set is where they differ.
create or replace function public.notif_type_default_channels(p_type text)
returns text[] language sql immutable as $$
  select case p_type
    when 'room_joined'  then array['inapp']
    when 'lunch_return' then array['inapp']
    else array['inapp', 'desktop']
  end;
$$;

-- ── emit_notification — the one true entry point ─────────────
create or replace function public.emit_notification(
  p_recipient   uuid,
  p_type        text,
  p_title       text,
  p_body        text default null,
  p_payload     jsonb default '{}'::jsonb,
  p_actor       uuid default null,
  p_team_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_dedupe_key  text default null,
  p_dedupe_window_minutes int default 60
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled    boolean;
  v_channels   text[];
  v_desktop_ok boolean;
  v_id         uuid;
begin
  -- 0. Never notify yourself about your own action.
  if p_actor is not null and p_actor = p_recipient then
    return null;
  end if;

  -- 1. Effective prefs: per-type override → type default.
  select np.enabled, np.channels into v_enabled, v_channels
    from public.notification_preferences np
   where np.user_id = p_recipient and np.type = p_type;
  if v_enabled is null then
    v_enabled  := true;
    v_channels := public.notif_type_default_channels(p_type);
  end if;
  if not v_enabled then
    return null;
  end if;

  -- 2. Global desktop switch (quiet hours are applied client-side in local tz).
  select coalesce(us.notif_desktop_enabled, true) into v_desktop_ok
    from public.user_settings us where us.user_id = p_recipient;
  if v_desktop_ok is distinct from true then
    v_channels := array_remove(v_channels, 'desktop');
  end if;
  if v_channels is null or cardinality(v_channels) = 0 then
    v_channels := array['inapp'];  -- always at least record it in the inbox
  end if;

  -- 3. Dedupe: skip a same-key row within the window.
  if p_dedupe_key is not null and exists (
    select 1 from public.notifications n
     where n.recipient_user_id = p_recipient
       and n.dedupe_key = p_dedupe_key
       and n.created_at > now() - make_interval(mins => p_dedupe_window_minutes)
  ) then
    return null;
  end if;

  -- 4. Insert (the bus event).
  insert into public.notifications
    (recipient_user_id, type, title, body, payload, actor_user_id, team_id,
     entity_type, entity_id, channels, dedupe_key)
  values
    (p_recipient, p_type, p_title, p_body, coalesce(p_payload, '{}'::jsonb),
     p_actor, p_team_id, p_entity_type, p_entity_id, v_channels, p_dedupe_key)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.emit_notification(
  uuid, text, text, text, jsonb, uuid, uuid, text, uuid, text, int
) to authenticated;

notify pgrst, 'reload schema';
