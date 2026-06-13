-- Live / Closed state on retros.
--
-- The previous migration made past-week retros read-only via an
-- is_retro_current_week() check baked into RLS. That worked but left
-- no escape hatch: an admin couldn't reopen an older retro to fix a
-- mistake, and couldn't close out the current week early either.
--
-- Replace that auto-rule with an explicit is_live flag the admin can
-- toggle. Default for new retros is live; backfill marks anything
-- before the current ISO Monday as closed so we land in the same
-- behaviour we shipped, but now under admin control.

alter table public.retros
  add column if not exists is_live boolean not null default true;

-- Backfill: past retros start closed so the UI doesn't suddenly
-- become editable on every old row.
update public.retros
   set is_live = false
 where week_start < date_trunc('week', current_date)::date
   and is_live = true;

create or replace function public.is_retro_live(p_retro_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.retros where id = p_retro_id and is_live = true
  );
$$;

grant execute on function public.is_retro_live(uuid) to authenticated;

-- Replace card-write policies: they now key off is_live instead of
-- the calendar-week check.

drop policy if exists "Participants can insert their own cards in current-week retros" on public.retro_cards;
create policy "Participants can insert their own cards in live retros"
  on public.retro_cards for insert
  with check (
    author_id = auth.uid()
    and public.is_retro_participant(retro_id)
    and public.is_retro_live(retro_id)
  );

drop policy if exists "Authors can update their own cards in current-week retros" on public.retro_cards;
create policy "Authors can update their own cards in live retros"
  on public.retro_cards for update
  using (
    author_id = auth.uid()
    and public.is_retro_live(retro_id)
  );

drop policy if exists "Authors or admins can delete cards in current-week retros" on public.retro_cards;
create policy "Authors or admins can delete cards in live retros"
  on public.retro_cards for delete
  using (
    public.is_retro_live(retro_id)
    and (
      author_id = auth.uid()
      or retro_id in (
        select r.id from public.retros r
        join public.team_members tm on tm.team_id = r.team_id
        where tm.user_id = auth.uid() and tm.role = 'admin'
      )
    )
  );

-- Update retros UPDATE policy similarly. Admins editing the goal go
-- through set_retro_goal (security definer); this policy mostly
-- protects direct field updates like is_open from non-admins.
drop policy if exists "Admins can update current-week retros" on public.retros;
create policy "Admins can update live retros"
  on public.retros for update
  using (
    public.is_retro_live(id)
    and team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Goal RPC: gate on is_live instead of the week check.
create or replace function public.set_retro_goal(p_retro_id uuid, p_goal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_is_live boolean;
begin
  select team_id, is_live into v_team_id, v_is_live
    from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if not v_is_live then
    raise exception 'Retro is closed';
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

-- New admin RPC: flip is_live on a retro. Doubles as Close (live → not)
-- and Reopen (not → live).
create or replace function public.set_retro_live(p_retro_id uuid, p_is_live boolean)
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
    raise exception 'Only team admins can change the retro state';
  end if;
  update public.retros set is_live = coalesce(p_is_live, true) where id = p_retro_id;
end;
$$;

grant execute on function public.set_retro_live(uuid, boolean) to authenticated;

-- Guest join: closed retros should refuse new guests too.
create or replace function public.join_retro_by_code(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retro public.retros;
  v_clean_name text;
begin
  select * into v_retro from public.retros
    where invite_code = upper(trim(p_code));
  if v_retro is null then
    raise exception 'Invalid retro code';
  end if;
  if not v_retro.is_open or not v_retro.is_live then
    raise exception 'This retro is closed to new participants';
  end if;

  v_clean_name := trim(coalesce(p_display_name, ''));
  if length(v_clean_name) = 0 then
    raise exception 'Display name is required';
  end if;

  if exists (
    select 1 from public.team_members
    where team_id = v_retro.team_id and user_id = auth.uid()
  ) then
    return v_retro.id;
  end if;

  insert into public.retro_guests (retro_id, user_id, display_name)
  values (v_retro.id, auth.uid(), v_clean_name)
  on conflict (retro_id, user_id) do update
    set display_name = excluded.display_name;

  return v_retro.id;
end;
$$;

-- Guest preview: surface is_live so the join page can show "this retro
-- has been closed" instead of a generic error.
create or replace function public.get_retro_invite_preview(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retro public.retros;
  v_team public.teams;
begin
  select * into v_retro from public.retros
    where invite_code = upper(trim(p_code));
  if v_retro is null then
    return json_build_object('error', 'Invalid retro code');
  end if;
  if not v_retro.is_live then
    return json_build_object('error', 'This retro has been closed by the team admin');
  end if;
  if not v_retro.is_open then
    return json_build_object('error', 'This retro is closed to new participants');
  end if;
  select * into v_team from public.teams where id = v_retro.team_id;
  return json_build_object(
    'retro_id', v_retro.id,
    'team_name', v_team.name,
    'team_icon_url', v_team.icon_url,
    'team_color', coalesce(v_team.color, '#14b8a6'),
    'department', v_retro.department,
    'week_start', v_retro.week_start
  );
end;
$$;

-- list_team_retros: include is_live so the UI can show the right state
-- per row without an extra round-trip.
drop function if exists public.list_team_retros(uuid);

create function public.list_team_retros(p_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  department text,
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
    r.week_start,
    r.goal,
    r.invite_code,
    (r.week_start = date_trunc('week', current_date)::date) as is_current_week,
    r.is_live,
    (select count(*)::int from public.retro_cards rc where rc.retro_id = r.id) as card_count
  from public.retros r
  where r.team_id = p_team_id
    and exists (
      select 1 from public.team_members
      where team_id = r.team_id and user_id = auth.uid()
    )
  order by r.week_start desc, r.department asc;
$$;

grant execute on function public.list_team_retros(uuid) to authenticated;

notify pgrst, 'reload schema';
