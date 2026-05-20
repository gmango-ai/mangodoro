-- Teams and team membership

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index teams_invite_code_idx on public.teams (invite_code);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);
create index team_members_team_id_idx on public.team_members (team_id);

-- RLS: teams

alter table public.teams enable row level security;

create policy "Members can read their teams"
  on public.teams for select
  using (
    id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "Authenticated users can create teams"
  on public.teams for insert
  with check (auth.uid() = created_by);

create policy "Admins can update their teams"
  on public.teams for update
  using (
    id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can delete their teams"
  on public.teams for delete
  using (
    id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- RLS: team_members

alter table public.team_members enable row level security;

create policy "Members can read team members"
  on public.team_members for select
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "Users can join teams"
  on public.team_members for insert
  with check (auth.uid() = user_id);

create policy "Admins can update member roles"
  on public.team_members for update
  using (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can remove members or self-leave"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Additive RLS on entries: team admins can read member entries

create policy "Team admins can read member entries"
  on public.entries for select
  using (
    user_id in (
      select tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.user_id = auth.uid() and tm1.role = 'admin'
    )
  );

-- Additive RLS on user_settings: team admins can read member names

create policy "Team admins can read member settings"
  on public.user_settings for select
  using (
    user_id in (
      select tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.user_id = auth.uid() and tm1.role = 'admin'
    )
  );

-- Additive RLS on projects: team admins can read member projects

create policy "Team admins can read member projects"
  on public.projects for select
  using (
    user_id in (
      select tm2.user_id
      from public.team_members tm1
      join public.team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.user_id = auth.uid() and tm1.role = 'admin'
    )
  );

-- RPC: join team by invite code (security definer to bypass RLS for code lookup)

create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_existing uuid;
begin
  select id into v_team_id from public.teams where invite_code = lower(code);
  if v_team_id is null then
    raise exception 'Invalid invite code';
  end if;

  select id into v_existing
  from public.team_members
  where team_id = v_team_id and user_id = auth.uid();
  if v_existing is not null then
    return v_team_id; -- already a member
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, auth.uid(), 'member');

  return v_team_id;
end;
$$;
