-- First-class goals: a single CURRENT goal per "tag" — a department
-- (org_team) or an individual user — within a team. Whiteboard goal nodes
-- write here; the pomodoro / office displays read the latest per tag.
-- This sits alongside the legacy retros.goal path; goals can migrate over.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_type text not null check (owner_type in ('department', 'user')),
  owner_id uuid not null,
  owner_name text not null default '',
  owner_color text,
  body text not null default '',
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  source_board uuid references public.whiteboards(id) on delete set null,
  source_node text,
  unique (team_id, owner_type, owner_id)
);

create index if not exists goals_team_idx on public.goals (team_id);

alter table public.goals enable row level security;

drop policy if exists "Team members read goals" on public.goals;
create policy "Team members read goals" on public.goals
  for select using (team_id in (select public.get_my_team_ids()));

-- Writes go through these security-definer RPCs (membership-checked).

create or replace function public.set_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text,
  p_board uuid default null, p_node text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (p_team_id in (select public.get_my_team_ids())) then
    raise exception 'Not a member of this team';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    delete from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id;
    return;
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, set_by, set_at, source_board, source_node)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(p_body), auth.uid(), now(), p_board, p_node)
  on conflict (team_id, owner_type, owner_id)
  do update set owner_name = excluded.owner_name, owner_color = excluded.owner_color,
                body = excluded.body, set_by = excluded.set_by, set_at = now(),
                source_board = excluded.source_board, source_node = excluded.source_node;
end; $$;
grant execute on function public.set_goal(uuid, text, uuid, text, text, text, uuid, text) to authenticated;

create or replace function public.clear_goal(p_team_id uuid, p_owner_type text, p_owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (p_team_id in (select public.get_my_team_ids())) then
    raise exception 'Not a member of this team';
  end if;
  delete from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id;
end; $$;
grant execute on function public.clear_goal(uuid, text, uuid) to authenticated;

create or replace function public.list_team_goals(p_team_id uuid)
returns setof public.goals language sql security definer set search_path = '' as $$
  select * from public.goals
  where team_id = p_team_id and team_id in (select public.get_my_team_ids())
  order by set_at desc;
$$;
grant execute on function public.list_team_goals(uuid) to authenticated;

notify pgrst, 'reload schema';
