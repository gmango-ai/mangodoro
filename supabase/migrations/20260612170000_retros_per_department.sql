-- Retros: one per (team, department, week) instead of one per (team, week).
-- Surfaces the reality that SWE and PM hold separate end-of-week meetings
-- with different goals. Members tagged in multiple departments see each
-- of "their" retros via the chip switcher on /team/retro.
--
-- `department = ''` is the team-wide retro — the fallback for teams that
-- haven't curated a departments list yet, and the row Phase 3 already
-- created. Backfill leaves existing rows on '' so the model is
-- backward-compatible.
--
-- Also adds sticky_color to user_settings so each member can pick the
-- background tint for their retro cards.

alter table public.retros
  add column if not exists department text not null default '';

-- Swap the uniqueness constraint. The Phase 3 migration created an
-- implicit unique index from `unique (team_id, week_start)`. Find and
-- drop it, then add the new shape.
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.retros'::regclass
    and contype = 'u'
    and (
      select array_agg(attname order by attnum)
      from pg_attribute
      where attrelid = conrelid
        and attnum = any(conkey)
    ) = array['team_id', 'week_start']::name[];
  if v_constraint is not null then
    execute format('alter table public.retros drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.retros
  drop constraint if exists retros_team_id_department_week_start_key;
alter table public.retros
  add constraint retros_team_id_department_week_start_key
  unique (team_id, department, week_start);

-- Update the lazy-create RPC to accept a department. Returning type
-- doesn't change, so CREATE OR REPLACE is enough.

create or replace function public.get_or_create_current_retro(
  p_team_id uuid,
  p_department text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date;
  v_dept text;
  v_retro_id uuid;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this team';
  end if;

  v_week_start := date_trunc('week', current_date)::date;
  v_dept := coalesce(trim(p_department), '');

  select id into v_retro_id
  from public.retros
  where team_id = p_team_id
    and department = v_dept
    and week_start = v_week_start;

  if v_retro_id is not null then
    return v_retro_id;
  end if;

  insert into public.retros (team_id, department, week_start, created_by)
  values (p_team_id, v_dept, v_week_start, auth.uid())
  returning id into v_retro_id;

  return v_retro_id;
end;
$$;

grant execute on function public.get_or_create_current_retro(uuid, text) to authenticated;

-- The single-arg version from Phase 3 stays for backwards-compat with
-- already-deployed clients during a rolling release. It delegates to
-- the new two-arg version with an empty department.
create or replace function public.get_or_create_current_retro(p_team_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.get_or_create_current_retro(p_team_id, '');
$$;

grant execute on function public.get_or_create_current_retro(uuid) to authenticated;

-- Sticky color per user. Stored on user_settings so it applies across
-- every team the user belongs to. Default is a friendly pastel yellow.

alter table public.user_settings
  add column if not exists sticky_color text not null default '#fde68a';

-- check constraint is added separately so the migration is idempotent
-- (alter add constraint has no "if not exists" form before PG 17, but
-- pg_constraint catalog can be consulted)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_settings_sticky_color_hex_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_sticky_color_hex_check
      check (sticky_color ~* '^#[0-9a-f]{6}$');
  end if;
end $$;

-- The `departments` text[] tag column on team_members came from a separate
-- dept-tags PR that isn't part of this migration line. The function below
-- selects it, so ensure the column exists on a fresh database — a no-op where
-- it's already present (e.g. environments that ran the dept-tags PR).
alter table public.team_members
  add column if not exists departments text[] not null default '{}';

-- Extend get_team_member_profiles to surface each member's sticky_color
-- so retro cards can render with the author's chosen background tint.
-- DROP FUNCTION is required: we're changing the RETURNS TABLE shape.

drop function if exists public.get_team_member_profiles(uuid);

create function public.get_team_member_profiles(p_team_id uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  status text,
  presence_state text,
  status_updated_at timestamptz,
  role text,
  joined_at timestamptz,
  departments text[],
  sticky_color text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text       as name,
    coalesce(us.avatar_url, '')::text            as avatar_url,
    coalesce(us.status, '')::text                as status,
    coalesce(us.presence_state, 'active')::text  as presence_state,
    us.status_updated_at,
    tm.role,
    tm.joined_at,
    tm.departments,
    coalesce(us.sticky_color, '#fde68a')::text   as sticky_color
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
    and exists (
      select 1
      from public.team_members tm2
      where tm2.team_id = p_team_id
        and tm2.user_id = auth.uid()
    )
  order by tm.joined_at asc;
$$;

grant execute on function public.get_team_member_profiles(uuid) to authenticated;

notify pgrst, 'reload schema';
