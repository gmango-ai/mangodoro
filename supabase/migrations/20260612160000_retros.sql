-- Retros: weekly end-of-week review for a team.
--
-- One retro per team per ISO week (Monday-start). Lazy-created on first
-- visit to /team/retro so we don't need a cron. Four lanes; admins set
-- the goal, any member adds/edits/deletes their own cards.
--
-- Phase 3 = foundation only: schema + CRUD + goal.
-- Phase 4 adds realtime + emotes; Phase 5 adds the meeting timer +
-- presenter order + music. The data model here supports all of that
-- without changes.

do $$
begin
  create type public.retro_lane as enum ('celebrate', 'went_well', 'to_improve', 'next_week');
exception when duplicate_object then null;
end $$;

create table if not exists public.retros (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  week_start date not null,
  goal text not null default '',
  goal_set_by uuid references auth.users(id),
  goal_updated_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, week_start)
);

create index if not exists retros_team_week_idx on public.retros (team_id, week_start desc);

create table if not exists public.retro_cards (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null references public.retros(id) on delete cascade,
  lane public.retro_lane not null,
  body text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  -- Spotlight is unused in Phase 3 but the column exists so Phase 4
  -- doesn't need a schema change to enable presenter-mode highlights.
  spotlighted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(body) > 0 and length(body) <= 500)
);

create index if not exists retro_cards_retro_lane_idx
  on public.retro_cards (retro_id, lane, created_at);

-- Realtime publication so Phase 4's postgres_changes subscriptions
-- pick rows up without an additional migration.
alter table public.retros replica identity full;
alter table public.retro_cards replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.retros;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.retro_cards;
exception when duplicate_object then null;
end $$;

-- RLS: retros

alter table public.retros enable row level security;

drop policy if exists "Team members can read retros" on public.retros;
create policy "Team members can read retros"
  on public.retros for select
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

-- Inserts go through the lazy-create RPC (security definer). No insert
-- policy needed for non-admins.

drop policy if exists "Admins can update retros" on public.retros;
create policy "Admins can update retros"
  on public.retros for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Admins can delete retros" on public.retros;
create policy "Admins can delete retros"
  on public.retros for delete
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- RLS: retro_cards
--
-- Cards are gated by membership in the parent retro's team. Author can
-- update/delete their own; admins can delete any (useful for removing
-- inappropriate content) but not edit content written by others —
-- attribution matters.

alter table public.retro_cards enable row level security;

drop policy if exists "Team members can read retro cards" on public.retro_cards;
create policy "Team members can read retro cards"
  on public.retro_cards for select
  using (
    retro_id in (
      select r.id from public.retros r
      join public.team_members tm on tm.team_id = r.team_id
      where tm.user_id = auth.uid()
    )
  );

drop policy if exists "Team members can insert their own cards" on public.retro_cards;
create policy "Team members can insert their own cards"
  on public.retro_cards for insert
  with check (
    author_id = auth.uid()
    and retro_id in (
      select r.id from public.retros r
      join public.team_members tm on tm.team_id = r.team_id
      where tm.user_id = auth.uid()
    )
  );

drop policy if exists "Authors can update their own cards" on public.retro_cards;
create policy "Authors can update their own cards"
  on public.retro_cards for update
  using (author_id = auth.uid());

drop policy if exists "Authors or admins can delete cards" on public.retro_cards;
create policy "Authors or admins can delete cards"
  on public.retro_cards for delete
  using (
    author_id = auth.uid()
    or retro_id in (
      select r.id from public.retros r
      join public.team_members tm on tm.team_id = r.team_id
      where tm.user_id = auth.uid() and tm.role = 'admin'
    )
  );

-- updated_at trigger for retro_cards so realtime + UI can ignore the
-- column's freshness without us having to set it client-side.
create or replace function public.retro_cards_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_retro_cards_touch on public.retro_cards;
create trigger tr_retro_cards_touch
  before update on public.retro_cards
  for each row
  execute function public.retro_cards_touch_updated_at();

-- Lazy-create RPC. Returns the retro id for (team_id, current ISO week).
-- Idempotent — repeat calls within the same week return the same row.
-- Security definer because new members may not yet have an INSERT
-- policy on retros (we deliberately don't grant one); the function's
-- own membership check provides the gate.

create or replace function public.get_or_create_current_retro(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date;
  v_retro_id uuid;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this team';
  end if;

  -- ISO week: Monday as the first day. date_trunc('week', x) returns
  -- Monday in Postgres (1-7 = Mon-Sun).
  v_week_start := date_trunc('week', current_date)::date;

  select id into v_retro_id
  from public.retros
  where team_id = p_team_id and week_start = v_week_start;

  if v_retro_id is not null then
    return v_retro_id;
  end if;

  insert into public.retros (team_id, week_start, created_by)
  values (p_team_id, v_week_start, auth.uid())
  returning id into v_retro_id;

  return v_retro_id;
end;
$$;

grant execute on function public.get_or_create_current_retro(uuid) to authenticated;

-- Goal setter — admin-only, sets goal_set_by + goal_updated_at in one
-- shot so the client doesn't have to. Security definer because the goal
-- columns are tracked across the row; doing it via the bare UPDATE
-- policy would also work, but the RPC keeps the audit fields honest.

create or replace function public.set_retro_goal(p_retro_id uuid, p_goal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = v_team_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only team admins can set the goal';
  end if;

  update public.retros
    set goal = coalesce(p_goal, ''),
        goal_set_by = auth.uid(),
        goal_updated_at = now()
    where id = p_retro_id;
end;
$$;

grant execute on function public.set_retro_goal(uuid, text) to authenticated;

notify pgrst, 'reload schema';
