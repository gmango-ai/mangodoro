-- External members + history support for retros.
--
-- 1. Per-retro invite_code (6-char) so external guests can join a single
--    retro without being on the team. retros.is_open controls whether
--    the code currently accepts new joins.
-- 2. retro_guests table: anyone with a valid invite code who isn't a
--    team_member gets attached here. Cards from guests are attributed
--    to their auth.uid() via author_id, same as team-member cards.
-- 3. RLS: past retros are read-only. Any retro whose week_start is
--    earlier than the current ISO Monday rejects card inserts/updates
--    and goal updates.
-- 4. Lazy-create RPC stays the entry point for the current week's
--    retro; new join_retro_by_code RPC handles guest attachment + an
--    explicit display_name (so guests don't have to set up a profile).

alter table public.retros
  add column if not exists invite_code text,
  add column if not exists is_open boolean not null default true;

-- Backfill a code for every existing retro so the column has data
-- before it becomes unique. Uses a portable base32-ish encoding to
-- avoid the confusable 0/O/1/I/L characters.
update public.retros
   set invite_code = upper(substring(translate(encode(extensions.gen_random_bytes(4), 'base64'), '+/=01OIl', ''), 1, 6))
 where invite_code is null;

create unique index if not exists retros_invite_code_unique
  on public.retros (invite_code) where invite_code is not null;

-- Make the column required going forward.
alter table public.retros
  alter column invite_code set not null;

-- Trigger: auto-generate an invite code for newly-created retros so
-- the RPC doesn't have to.
create or replace function public.retros_generate_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invite_code is null or new.invite_code = '' then
    new.invite_code := upper(substring(translate(encode(extensions.gen_random_bytes(4), 'base64'), '+/=01OIl', ''), 1, 6));
  end if;
  return new;
end;
$$;

drop trigger if exists tr_retros_invite_code on public.retros;
create trigger tr_retros_invite_code
  before insert on public.retros
  for each row
  execute function public.retros_generate_invite_code();

-- Guest membership. Distinct from team_members; doesn't grant any other
-- team access. Display name is stored here so guests don't have to
-- create a user_settings profile.
create table if not exists public.retro_guests (
  retro_id uuid not null references public.retros(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (retro_id, user_id)
);

create index if not exists retro_guests_user_idx on public.retro_guests (user_id);

alter table public.retro_guests replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.retro_guests;
exception when duplicate_object then null;
end $$;

alter table public.retro_guests enable row level security;

drop policy if exists "Team members and guests can read retro guests" on public.retro_guests;
create policy "Team members and guests can read retro guests"
  on public.retro_guests for select
  using (
    -- Guests can see themselves and other guests of the same retro.
    retro_id in (
      select retro_id from public.retro_guests where user_id = auth.uid()
    )
    -- Team members of the retro's team can see everyone.
    or retro_id in (
      select r.id from public.retros r
      join public.team_members tm on tm.team_id = r.team_id
      where tm.user_id = auth.uid()
    )
  );

-- Inserts go through the join RPC (security definer), so no insert
-- policy is needed for non-admins.

drop policy if exists "Authors can leave (delete their own guest row)" on public.retro_guests;
create policy "Authors can leave (delete their own guest row)"
  on public.retro_guests for delete
  using (user_id = auth.uid());

-- Helper: is the caller a participant (member or guest) of this retro?
create or replace function public.is_retro_participant(p_retro_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.retro_guests
    where retro_id = p_retro_id and user_id = auth.uid()
  ) or exists (
    select 1 from public.retros r
    join public.team_members tm on tm.team_id = r.team_id
    where r.id = p_retro_id and tm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_retro_participant(uuid) to authenticated;

-- Helper: is this retro for the current ISO week (and therefore
-- editable)? Past retros become read-only.
create or replace function public.is_retro_current_week(p_retro_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.retros
    where id = p_retro_id
      and week_start = date_trunc('week', current_date)::date
  );
$$;

grant execute on function public.is_retro_current_week(uuid) to authenticated;

-- Extend retro_cards read+write so guests participate as first-class
-- authors, and lock past-week retros from edits/inserts.

drop policy if exists "Team members can read retro cards" on public.retro_cards;
create policy "Participants can read retro cards"
  on public.retro_cards for select
  using (public.is_retro_participant(retro_id));

drop policy if exists "Team members can insert their own cards" on public.retro_cards;
create policy "Participants can insert their own cards in current-week retros"
  on public.retro_cards for insert
  with check (
    author_id = auth.uid()
    and public.is_retro_participant(retro_id)
    and public.is_retro_current_week(retro_id)
  );

drop policy if exists "Authors can update their own cards" on public.retro_cards;
create policy "Authors can update their own cards in current-week retros"
  on public.retro_cards for update
  using (
    author_id = auth.uid()
    and public.is_retro_current_week(retro_id)
  );

drop policy if exists "Authors or admins can delete cards" on public.retro_cards;
create policy "Authors or admins can delete cards in current-week retros"
  on public.retro_cards for delete
  using (
    public.is_retro_current_week(retro_id)
    and (
      author_id = auth.uid()
      or retro_id in (
        select r.id from public.retros r
        join public.team_members tm on tm.team_id = r.team_id
        where tm.user_id = auth.uid() and tm.role = 'admin'
      )
    )
  );

-- Extend retros read so guests can see their retro row.

drop policy if exists "Team members can read retros" on public.retros;
create policy "Participants can read retros"
  on public.retros for select
  using (public.is_retro_participant(id));

-- Block goal edits on past-week retros (admins on the current week
-- are still fine through the existing UPDATE policy + the goal RPC).

drop policy if exists "Admins can update retros" on public.retros;
create policy "Admins can update current-week retros"
  on public.retros for update
  using (
    public.is_retro_current_week(id)
    and team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Tighten set_retro_goal similarly so past-week edits also fail at
-- the RPC layer (UPDATE policy alone isn't applied to security-definer
-- RPCs).
create or replace function public.set_retro_goal(p_retro_id uuid, p_goal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_week_start date;
begin
  select team_id, week_start into v_team_id, v_week_start
    from public.retros where id = p_retro_id;
  if v_team_id is null then
    raise exception 'Retro not found';
  end if;
  if v_week_start <> date_trunc('week', current_date)::date then
    raise exception 'Past retros are read-only';
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

-- Lookup-only RPC for the guest landing page so a non-participant can
-- preview team + week range without seeing card content.
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
  if not v_retro.is_open then
    return json_build_object('error', 'This retro is closed to new participants');
  end if;
  if v_retro.week_start <> date_trunc('week', current_date)::date then
    return json_build_object('error', 'This retro is no longer active');
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

grant execute on function public.get_retro_invite_preview(text) to anon, authenticated;

-- Guest join RPC. Caller must already be authenticated (we sign them
-- in anonymously on the join page if they don't have a session yet).
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
  if not v_retro.is_open then
    raise exception 'This retro is closed to new participants';
  end if;
  if v_retro.week_start <> date_trunc('week', current_date)::date then
    raise exception 'This retro is no longer active';
  end if;

  v_clean_name := trim(coalesce(p_display_name, ''));
  if length(v_clean_name) = 0 then
    raise exception 'Display name is required';
  end if;

  -- Team members are already authorized through team_members; we don't
  -- need to add them as guests. Idempotent for repeat calls.
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

grant execute on function public.join_retro_by_code(text, text) to authenticated;

-- Guest display names need to be visible to the retro UI alongside
-- regular member profiles. Surface them through a participant-list RPC
-- so the client can render attribution without two queries.
create or replace function public.get_retro_participants(p_retro_id uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  sticky_color text,
  is_guest boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text             as name,
    coalesce(us.avatar_url, '')::text                  as avatar_url,
    coalesce(us.sticky_color, '#fde68a')::text         as sticky_color,
    false                                              as is_guest
  from public.retros r
  join public.team_members tm on tm.team_id = r.team_id
  left join public.user_settings us on us.user_id = tm.user_id
  where r.id = p_retro_id
    and public.is_retro_participant(p_retro_id)
  union all
  select
    rg.user_id,
    case when length(rg.display_name) > 0 then rg.display_name
         else 'Guest' end                              as name,
    coalesce(us.avatar_url, '')::text                  as avatar_url,
    coalesce(us.sticky_color, '#fde68a')::text         as sticky_color,
    true                                               as is_guest
  from public.retro_guests rg
  left join public.user_settings us on us.user_id = rg.user_id
  where rg.retro_id = p_retro_id
    and public.is_retro_participant(p_retro_id);
$$;

grant execute on function public.get_retro_participants(uuid) to authenticated;

-- List all retros visible to the caller for a given team — used by the
-- /retros listing page. Returns one row per (department, week_start)
-- ordered by week_start desc.
create or replace function public.list_team_retros(p_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  department text,
  week_start date,
  goal text,
  invite_code text,
  is_current_week boolean,
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
