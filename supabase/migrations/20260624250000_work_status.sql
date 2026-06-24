-- work_status: the team-visible projection of a person's private clock
-- (user_settings.active_clock stays private). One row per user; teammates can
-- read it to see who's clocked in right now, what they're on, and for how long.
-- Powers the "working now" roster + clocked-in presence.

create table if not exists public.work_status (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete set null, -- the office context (optional)
  clocked_in_at timestamptz,           -- null = not clocked in
  on_break      boolean not null default false,
  task          text,
  updated_at    timestamptz not null default now()
);

alter table public.work_status replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.work_status;
exception when duplicate_object then null; end $$;

alter table public.work_status enable row level security;

-- Read: yourself + anyone you share a team with.
drop policy if exists "read own or teammates work_status" on public.work_status;
create policy "read own or teammates work_status" on public.work_status
  for select using (
    user_id = auth.uid()
    or user_id in (
      select tm2.user_id from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
      where tm1.user_id = auth.uid()
    )
  );

-- Write: only your own row.
drop policy if exists "owner writes own work_status" on public.work_status;
create policy "owner writes own work_status" on public.work_status
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
