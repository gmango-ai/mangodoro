-- Goals: multiple per owner + active/done status + manage-outside-the-whiteboard.
--
-- Before: a single CURRENT goal per (team, owner) — set_goal upserted on a
-- unique(team,owner_type,owner_id). Now a person/department can have several
-- goals. We re-key the WHITEBOARD path to (source_board, source_node) so each
-- goal node maps to its own goal, and add id-based CRUD RPCs for the new
-- profile/team manage surfaces. Writes stay team-membership-gated (matching the
-- existing permissive whiteboard behaviour — any team member can set team goals).

-- Drop the one-per-owner uniqueness; add status + ordering.
alter table public.goals drop constraint if exists goals_team_id_owner_type_owner_id_key;
alter table public.goals
  add column if not exists status text not null default 'active' check (status in ('active', 'done')),
  add column if not exists completed_at timestamptz,
  add column if not exists position integer not null default 0;

-- A whiteboard goal node maps to exactly one goal.
create unique index if not exists goals_source_node_uniq
  on public.goals (source_board, source_node) where source_node is not null;

-- ── set_goal: whiteboard path, now keyed by (board, node) ────
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
  -- Empty body clears this node's goal.
  if coalesce(btrim(p_body), '') = '' then
    delete from public.goals where source_board = p_board and source_node = p_node and p_node is not null;
    return;
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, set_by, set_at, source_board, source_node)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(p_body), auth.uid(), now(), p_board, p_node)
  on conflict (source_board, source_node) where source_node is not null
  do update set team_id = excluded.team_id, owner_type = excluded.owner_type, owner_id = excluded.owner_id,
                owner_name = excluded.owner_name, owner_color = excluded.owner_color,
                body = excluded.body, set_by = excluded.set_by, set_at = now();
end; $$;
grant execute on function public.set_goal(uuid, text, uuid, text, text, text, uuid, text) to authenticated;

-- Clear a specific whiteboard node's goal (replaces clear-by-owner for nodes).
create or replace function public.clear_goal_node(p_board uuid, p_node text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.goals g
   where g.source_board = p_board and g.source_node = p_node
     and g.team_id in (select public.get_my_team_ids());
end; $$;
grant execute on function public.clear_goal_node(uuid, text) to authenticated;

-- ── id-based CRUD for the manage UI ──────────────────────────
create or replace function public.create_goal(
  p_team_id uuid, p_owner_type text, p_owner_id uuid,
  p_owner_name text, p_owner_color text, p_body text
)
returns public.goals language plpgsql security definer set search_path = '' as $$
declare v_row public.goals;
begin
  if not (p_team_id in (select public.get_my_team_ids())) then
    raise exception 'Not a member of this team';
  end if;
  insert into public.goals (team_id, owner_type, owner_id, owner_name, owner_color, body, set_by, set_at, position)
  values (p_team_id, p_owner_type, p_owner_id, coalesce(p_owner_name, ''), p_owner_color, btrim(coalesce(p_body, '')), auth.uid(), now(),
          coalesce((select max(position) + 1 from public.goals where team_id = p_team_id and owner_type = p_owner_type and owner_id = p_owner_id), 0))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_goal(uuid, text, uuid, text, text, text) to authenticated;

create or replace function public.update_goal(
  p_id uuid, p_body text default null, p_status text default null
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
         completed_at = case when p_status = 'done' then now()
                             when p_status = 'active' then null
                             else g.completed_at end
   where g.id = p_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.update_goal(uuid, text, text) to authenticated;

create or replace function public.delete_goal(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.goals g
   where g.id = p_id and g.team_id in (select public.get_my_team_ids());
end; $$;
grant execute on function public.delete_goal(uuid) to authenticated;

notify pgrst, 'reload schema';
