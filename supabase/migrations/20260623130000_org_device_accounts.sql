-- Org device accounts — a shared kiosk/display logs into an org without a
-- personal email. A device is a real auth user (synthetic email + a high-entropy
-- random password, created server-side by the device-provision edge function),
-- PINNED to one room, with LEAST-PRIVILEGE read access to just that room's timer
-- + presence. It is deliberately NOT a team_members row, so it can't see org
-- member lists, other rooms, time entries, etc. — access comes only from the
-- device-scoped policies below.

-- Flag the device's own profile row so the app can route a device session to
-- the kiosk shell instead of the full member app.
alter table public.user_settings
  add column if not exists is_device boolean not null default false;

-- ── device registry (admin-managed) ─────────────────────────────
create table if not exists public.org_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.teams(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  -- one-time pairing: only a hash + expiry is stored; cleared on redeem.
  pairing_code_hash text,
  pairing_expires_at timestamptz
);
create index if not exists org_devices_org_idx on public.org_devices (org_id) where revoked_at is null;
create index if not exists org_devices_room_idx on public.org_devices (room_id) where revoked_at is null;

alter table public.org_devices enable row level security;

-- Org admins read their org's devices (for the management UI). Writes are
-- service-role only (via edge functions), so there are NO client write policies
-- — an admin can't forge a device row or change a device's scope directly.
drop policy if exists "org admins read devices" on public.org_devices;
create policy "org admins read devices" on public.org_devices for select
  using (public.is_org_admin(org_id));

-- A device may read its OWN row (to learn its room / org / name).
drop policy if exists "device reads self" on public.org_devices;
create policy "device reads self" on public.org_devices for select
  using (user_id = auth.uid());

-- ── service-role-only secrets ────────────────────────────────────
-- The device's auth password, needed to mint a session at pairing time. RLS is
-- ON with NO policies, so ONLY the service role (edge functions) can read it —
-- never a browser, never an admin.
create table if not exists public.org_device_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password text not null,
  created_at timestamptz not null default now()
);
alter table public.org_device_secrets enable row level security;

-- ── helpers: the current device user's pinned room / org ─────────
-- security definer so a device can resolve its own scope without a broad SELECT
-- grant on org_devices. Returns null for a non-device user, which makes every
-- device-scoped policy below evaluate to false for everyone else.
create or replace function public.current_device_room()
returns uuid language sql stable security definer set search_path = '' as $$
  select room_id from public.org_devices
   where user_id = auth.uid() and revoked_at is null
   limit 1
$$;
grant execute on function public.current_device_room() to authenticated;

create or replace function public.current_device_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_devices
   where user_id = auth.uid() and revoked_at is null
   limit 1
$$;
grant execute on function public.current_device_org() to authenticated;

-- ── device-scoped read access (additive; least privilege) ───────
-- Permissive SELECT policies that grant a device read access to EXACTLY its
-- room's display data — nothing else. OR'd with the existing member policies, so
-- they don't widen anyone else's access. Participant rows already carry display
-- name / avatar / presence, so the kiosk needs no access to user_settings.

drop policy if exists "device reads its room" on public.rooms;
create policy "device reads its room" on public.rooms for select
  using (id = public.current_device_room());

drop policy if exists "device reads its org" on public.teams;
create policy "device reads its org" on public.teams for select
  using (id = public.current_device_org());

drop policy if exists "device reads its room sessions" on public.sync_sessions;
create policy "device reads its room sessions" on public.sync_sessions for select
  using (room_id = public.current_device_room());

drop policy if exists "device reads its room participants" on public.sync_session_participants;
create policy "device reads its room participants" on public.sync_session_participants for select
  using (
    session_id in (
      select id from public.sync_sessions where room_id = public.current_device_room()
    )
  );

notify pgrst, 'reload schema';
