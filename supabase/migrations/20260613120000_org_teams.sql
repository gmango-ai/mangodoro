-- Org → Team rearchitect.
--
-- Background: we shipped "departments" as text[] tags on team_members.
-- That was the wrong abstraction for what the product actually needs —
-- departments are access-control boundaries, not labels. Real-world
-- usage (SWE retro vs PM retro, dept-only pomodoro rooms, future
-- dept-scoped video calls, etc.) all need first-class entities with
-- explicit membership.
--
-- This migration introduces:
--   - org_teams: sub-team within an org (the existing `teams` table)
--   - org_team_members: explicit membership in an org_team
--   - retros.org_team_id and rooms.org_team_id FK columns
--   - Backfill: every value in teams.departments[] becomes an org_team,
--     every tag in team_members.departments[] becomes a row in
--     org_team_members.
--
-- The text[] tag columns are left in place for one release as a fallback
-- (and to feed any client that hasn't pulled the new RPCs yet). A
-- follow-up migration can drop them once everything's wired through.

-- ── Schema ─────────────────────────────────────────────────────

create table if not exists public.org_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  color text not null default '#14b8a6',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, name)
);

create index if not exists org_teams_org_idx
  on public.org_teams (org_id) where archived_at is null;

alter table public.org_teams replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.org_teams;
exception when duplicate_object then null;
end $$;

create table if not exists public.org_team_members (
  org_team_id uuid not null references public.org_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'lead')),
  joined_at timestamptz not null default now(),
  primary key (org_team_id, user_id)
);

create index if not exists org_team_members_user_idx
  on public.org_team_members (user_id);

alter table public.org_team_members replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.org_team_members;
exception when duplicate_object then null;
end $$;

-- ── RLS ────────────────────────────────────────────────────────

alter table public.org_teams enable row level security;

drop policy if exists "Org members read org_teams" on public.org_teams;
create policy "Org members read org_teams"
  on public.org_teams for select
  using (org_id in (select team_id from public.team_members where user_id = auth.uid()));

drop policy if exists "Org admins create org_teams" on public.org_teams;
create policy "Org admins create org_teams"
  on public.org_teams for insert
  with check (
    created_by = auth.uid()
    and org_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Org admins update org_teams" on public.org_teams;
create policy "Org admins update org_teams"
  on public.org_teams for update
  using (
    org_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Org admins delete org_teams" on public.org_teams;
create policy "Org admins delete org_teams"
  on public.org_teams for delete
  using (
    org_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

alter table public.org_team_members enable row level security;

-- Anyone in the same org can see the membership rows for that org's
-- teams. Org-level admins additionally can see all of it. This keeps
-- the team roster discoverable without leaking cross-org data.
drop policy if exists "Org members read org_team_members" on public.org_team_members;
create policy "Org members read org_team_members"
  on public.org_team_members for select
  using (
    org_team_id in (
      select ot.id from public.org_teams ot
      where ot.org_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

-- Only org admins manage memberships. Members themselves can leave
-- (delete their own row).
drop policy if exists "Org admins manage org_team_members" on public.org_team_members;
create policy "Org admins manage org_team_members"
  on public.org_team_members for insert
  with check (
    org_team_id in (
      select ot.id from public.org_teams ot
      where ot.org_id in (
        select team_id from public.team_members
        where user_id = auth.uid() and role = 'admin'
      )
    )
  );

drop policy if exists "Org admins or self can delete org_team_member" on public.org_team_members;
create policy "Org admins or self can delete org_team_member"
  on public.org_team_members for delete
  using (
    user_id = auth.uid()
    or org_team_id in (
      select ot.id from public.org_teams ot
      where ot.org_id in (
        select team_id from public.team_members
        where user_id = auth.uid() and role = 'admin'
      )
    )
  );

drop policy if exists "Org admins update org_team_member role" on public.org_team_members;
create policy "Org admins update org_team_member role"
  on public.org_team_members for update
  using (
    org_team_id in (
      select ot.id from public.org_teams ot
      where ot.org_id in (
        select team_id from public.team_members
        where user_id = auth.uid() and role = 'admin'
      )
    )
  );

-- ── Helpers ────────────────────────────────────────────────────

create or replace function public.is_org_team_member(p_org_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.org_team_members
    where org_team_id = p_org_team_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_org_team_member(uuid) to authenticated;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_org_id and user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_org_admin(uuid) to authenticated;

-- ── Retro + Room FK columns ────────────────────────────────────

alter table public.retros
  add column if not exists org_team_id uuid
  references public.org_teams(id) on delete set null;

create index if not exists retros_org_team_idx on public.retros (org_team_id);

alter table public.rooms
  add column if not exists org_team_id uuid
  references public.org_teams(id) on delete set null;

create index if not exists rooms_org_team_idx on public.rooms (org_team_id);

-- ── Backfill (guarded) ─────────────────────────────────────────
-- The teams.departments / team_members.departments columns came from
-- the Phase 2 dept-tags PR which may or may not be merged depending on
-- the environment. Guard the backfill so the migration runs cleanly
-- whether or not the legacy columns exist.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teams' and column_name = 'departments'
  ) then
    execute $sql$
      insert into public.org_teams (org_id, name, created_by)
      select t.id, trim(dept_name), t.created_by
        from public.teams t, unnest(t.departments) as dept_name
        where dept_name is not null and trim(dept_name) <> ''
      on conflict (org_id, name) do nothing
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'team_members' and column_name = 'departments'
  ) then
    execute $sql$
      insert into public.org_team_members (org_team_id, user_id)
      select ot.id, tm.user_id
        from public.team_members tm
        join unnest(tm.departments) as dept_name on true
        join public.org_teams ot
          on ot.org_id = tm.team_id
         and ot.name = trim(dept_name)
        where dept_name is not null and trim(dept_name) <> ''
      on conflict (org_team_id, user_id) do nothing
    $sql$;
  end if;
end $$;

-- Each retro with a non-empty department text gets linked to the
-- matching org_team via FK. Team-wide retros (department = '') keep
-- org_team_id = null.
update public.retros r
   set org_team_id = ot.id
  from public.org_teams ot
 where r.team_id = ot.org_id
   and r.department = ot.name
   and r.department <> '';

-- ── Update RPCs to surface the new shape ───────────────────────

-- list_team_retros now exposes org_team_id alongside the legacy
-- department text. Change the return shape, so drop+recreate.
drop function if exists public.list_team_retros(uuid);

create function public.list_team_retros(p_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  department text,
  org_team_id uuid,
  org_team_name text,
  week_start date,
  goal text,
  invite_code text,
  is_current_week boolean,
  is_live boolean,
  card_count int
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    r.id,
    r.team_id,
    r.department,
    r.org_team_id,
    ot.name as org_team_name,
    r.week_start,
    r.goal,
    r.invite_code,
    (r.week_start = date_trunc('week', current_date)::date) as is_current_week,
    r.is_live,
    (select count(*)::int from public.retro_cards rc where rc.retro_id = r.id) as card_count
  from public.retros r
  left join public.org_teams ot on ot.id = r.org_team_id
  where r.team_id = p_team_id
    and exists (
      select 1 from public.team_members
      where team_id = r.team_id and user_id = auth.uid()
    )
  order by r.week_start desc, ot.name asc nulls first, r.department asc;
$$;

grant execute on function public.list_team_retros(uuid) to authenticated;

-- Lazy-create RPC keyed on org_team_id. Empty/null team_id means the
-- team-wide retro (no org_team). Single-arg overload preserved for
-- back-compat.
create or replace function public.get_or_create_current_retro_for_team(
  p_org_id uuid,
  p_org_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date;
  v_retro_id uuid;
  v_dept_text text;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_org_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this org';
  end if;

  v_week_start := date_trunc('week', current_date)::date;

  -- Mirror department text from the org_team's name so any older code
  -- still keying on the text column doesn't see an empty cell.
  if p_org_team_id is not null then
    select name into v_dept_text from public.org_teams where id = p_org_team_id;
    -- Also gate creation on team membership for non-admins.
    if not exists (
      select 1 from public.org_team_members
      where org_team_id = p_org_team_id and user_id = auth.uid()
    ) and not exists (
      select 1 from public.team_members
      where team_id = p_org_id and user_id = auth.uid() and role = 'admin'
    ) then
      raise exception 'You must be a member of this team to start its retro';
    end if;
  end if;
  v_dept_text := coalesce(v_dept_text, '');

  select id into v_retro_id
  from public.retros
  where team_id = p_org_id
    and week_start = v_week_start
    and (
      (p_org_team_id is null and (org_team_id is null or department = ''))
      or (p_org_team_id is not null and org_team_id = p_org_team_id)
    );

  if v_retro_id is not null then
    return v_retro_id;
  end if;

  insert into public.retros (team_id, department, org_team_id, week_start, created_by)
  values (p_org_id, v_dept_text, p_org_team_id, v_week_start, auth.uid())
  returning id into v_retro_id;

  return v_retro_id;
end;
$$;

grant execute on function public.get_or_create_current_retro_for_team(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
