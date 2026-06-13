-- Retro lifecycle: archive (reversible) + admin-only hard delete.
--
-- Today retros toggle live <-> closed via is_live. Archive adds a
-- third state: archived retros are hidden from the default list and
-- read-only (is_live can't be re-set, cards can't be added). Admins
-- can fully delete (cascades to retro_cards and retro_guests via the
-- existing FKs).
--
-- Permission model: org admin OR is_org_team_lead(retro.org_team_id)
-- can archive/unarchive. Only admins can hard delete.

-- ── 1. archived_at column ────────────────────────────────────────

alter table public.retros
  add column if not exists archived_at timestamptz;

create index if not exists retros_team_archived_idx
  on public.retros (team_id, archived_at);

-- ── 2. archive / unarchive ──────────────────────────────────────

create or replace function public.archive_retro(p_retro_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_org_team_id uuid;
begin
  select team_id, org_team_id into v_team_id, v_org_team_id
    from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if not (
    exists (
      select 1 from public.team_members
      where team_id = v_team_id and user_id = auth.uid() and role = 'admin'
    )
    or (v_org_team_id is not null and public.is_org_team_lead(v_org_team_id))
  ) then
    raise exception 'Only org admins or team leads can archive this retro';
  end if;
  update public.retros
  set archived_at = now(),
      is_live = false  -- archived implies not-live too
  where id = p_retro_id;
end;
$$;

grant execute on function public.archive_retro(uuid) to authenticated;

create or replace function public.unarchive_retro(p_retro_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_org_team_id uuid;
begin
  select team_id, org_team_id into v_team_id, v_org_team_id
    from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if not (
    exists (
      select 1 from public.team_members
      where team_id = v_team_id and user_id = auth.uid() and role = 'admin'
    )
    or (v_org_team_id is not null and public.is_org_team_lead(v_org_team_id))
  ) then
    raise exception 'Only org admins or team leads can unarchive this retro';
  end if;
  update public.retros
  set archived_at = null
  where id = p_retro_id;
end;
$$;

grant execute on function public.unarchive_retro(uuid) to authenticated;

-- ── 3. delete (admin only, hard) ────────────────────────────────

create or replace function public.delete_retro(p_retro_id uuid)
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
    raise exception 'Only org admins can delete retros';
  end if;
  delete from public.retros where id = p_retro_id;
end;
$$;

grant execute on function public.delete_retro(uuid) to authenticated;

-- ── 4. Update set_retro_live to refuse archived retros ──────────

create or replace function public.set_retro_live(p_retro_id uuid, p_is_live boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_archived timestamptz;
begin
  select team_id, archived_at into v_team_id, v_archived
    from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if v_archived is not null then
    raise exception 'Archived retros are read-only; unarchive first';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = v_team_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only team admins can change the retro state';
  end if;
  update public.retros set is_live = coalesce(p_is_live, true) where id = p_retro_id;
end;
$$;

grant execute on function public.set_retro_live(uuid, boolean) to authenticated;

-- ── 5. Drop + recreate list_team_retros with archived_at + filter
--
-- The signature change requires a drop (Postgres doesn't allow
-- modifying a function's return shape in place). We base on the
-- org_teams 11-column version and add archived_at; the second arg
-- defaults to false so every existing caller behaves identically.

drop function if exists public.list_team_retros(uuid);
drop function if exists public.list_team_retros(uuid, boolean);

create function public.list_team_retros(
  p_team_id uuid,
  p_include_archived boolean default false
)
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
  archived_at timestamptz,
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
    r.archived_at,
    (select count(*)::int from public.retro_cards rc where rc.retro_id = r.id) as card_count
  from public.retros r
  left join public.org_teams ot on ot.id = r.org_team_id
  where r.team_id = p_team_id
    and (coalesce(p_include_archived, false) or r.archived_at is null)
    and exists (
      select 1 from public.team_members
      where team_id = r.team_id and user_id = auth.uid()
    )
  order by r.week_start desc, ot.name asc nulls first, r.department asc;
$$;

grant execute on function public.list_team_retros(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
