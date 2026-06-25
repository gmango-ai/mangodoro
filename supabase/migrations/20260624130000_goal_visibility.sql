-- Goal visibility: a personal (user) goal is PRIVATE by default — only the
-- owner sees it — unless they mark it public, in which case teammates can see
-- it on the owner's profile. Department goals are org-wide and unaffected.

alter table public.goals
  add column if not exists is_public boolean not null default false;

-- Tighten reads: a user's PRIVATE goals are visible only to themselves.
-- (Department goals + your own + others' public goals stay visible.)
drop policy if exists "Team members read goals" on public.goals;
create policy "Team members read goals" on public.goals
  for select using (
    team_id in (select public.get_my_team_ids())
    and (owner_type <> 'user' or owner_id = auth.uid() or is_public)
  );

-- Same filter in the security-definer list RPC (which bypasses RLS).
create or replace function public.list_team_goals(p_team_id uuid)
returns setof public.goals language sql security definer set search_path = '' as $$
  select * from public.goals
  where team_id = p_team_id and team_id in (select public.get_my_team_ids())
    and (owner_type <> 'user' or owner_id = auth.uid() or is_public)
  order by set_at desc;
$$;
grant execute on function public.list_team_goals(uuid) to authenticated;

-- update_goal gains is_public (drop+recreate to change the signature).
drop function if exists public.update_goal(uuid, text, text);
create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null, p_is_public boolean default null
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not exists (select 1 from public.goals g where g.id = p_id and g.team_id in (select public.get_my_team_ids())) then
    raise exception 'Goal not found or not permitted';
  end if;
  if p_status is not null and p_status not in ('active', 'done') then
    raise exception 'Invalid status';
  end if;
  update public.goals g
     set body = case when p_body is not null then btrim(p_body) else g.body end,
         status = coalesce(p_status, g.status),
         is_public = coalesce(p_is_public, g.is_public),
         completed_at = case when p_status = 'done' then now()
                             when p_status = 'active' then null
                             else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
