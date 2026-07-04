-- user_presence: the resolved status snapshot — seam ① of the status/
-- notification integration (see docs/plans/status-notification-integration.md).
--
-- The status resolver (client-side; src/lib/statusResolver.js) reads every
-- signal source — room membership, idle, clock (work_status), pomodoro, and
-- later calendar + car-Bluetooth — and collapses them into ONE coarse
-- availability + activity, written here. This is the single row that the
-- roster, room sidebar, nav chip, avatars, AND the notification router all
-- read, so "status" stops being four drifting copies.
--
-- Source signals stay on their own tables (work_status, task_segments,
-- user_pomodoro_state) — this is just the resolved projection. Writes are
-- throttled client-side EXCEPT availability transitions, which write
-- immediately so the notification router's snapshot stays fresh (plan §3.3).
--
-- Note on liveness: a client can't write 'offline' after its tab dies, so
-- true online/offline is still read from the realtime presence channel
-- (useTeamPresence) and overlaid by consumers. `availability` here is the
-- last resolved *intent*; realtime presence says whether they're connected.

create table if not exists public.user_presence (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  team_id             uuid references public.teams(id) on delete set null, -- office context (optional)

  -- Resolved coarse availability. New vocabulary that supersedes the legacy
  -- user_settings.presence_state during transition; 'pairing' is the single
  -- yellow "busy but reachable" state.
  availability        text not null default 'offline'
    check (availability in ('available','pairing','focusing','in_meeting',
                            'away','lunch','commuting','off','offline')),
  since               timestamptz,          -- when the current availability began

  -- Tier-0 activity ("what you're on"). Detail is redacted at WRITE time when
  -- private, so the shared row never carries the sensitive label/link; the
  -- availability + since stay visible regardless (plan §5 / Q4).
  activity_label      text,
  activity_link       text,
  activity_since      timestamptz,
  activity_private    boolean not null default false,

  -- Where you are.
  location_kind       text not null default 'none'
    check (location_kind in ('none','room','huddle')),
  location_room_id    uuid references public.rooms(id) on delete set null,

  -- Manual override — always wins over derivation until it expires/clears.
  override_availability text
    check (override_availability is null or override_availability in
           ('available','pairing','focusing','in_meeting',
            'away','lunch','commuting','off','offline')),
  override_message    text,
  override_expires_at timestamptz,
  override_set_at     timestamptz,

  updated_at          timestamptz not null default now()
);

-- Realtime: a status change reflects live in every open roster/sidebar/chip.
alter table public.user_presence replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.user_presence;
exception when duplicate_object then null; end $$;

alter table public.user_presence enable row level security;

-- Read: yourself + anyone you share a team with (same shape as work_status).
drop policy if exists "read own or teammates user_presence" on public.user_presence;
create policy "read own or teammates user_presence" on public.user_presence
  for select using (
    user_id = auth.uid()
    or user_id in (
      select tm2.user_id from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
      where tm1.user_id = auth.uid()
    )
  );

-- Write: only your own row.
drop policy if exists "owner writes own user_presence" on public.user_presence;
create policy "owner writes own user_presence" on public.user_presence
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep updated_at honest on every change.
create or replace function public.tg_user_presence_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
drop trigger if exists tr_user_presence_touch on public.user_presence;
create trigger tr_user_presence_touch
  before update on public.user_presence
  for each row execute function public.tg_user_presence_touch();

notify pgrst, 'reload schema';
