-- Per-retro flag: whether this retro's goal is surfaced as a "current
-- goal" in the pomodoro + office goal displays. A team can show one or
-- several at once. Replaces the implicit "previous ISO week" lookup with
-- an explicit, admin-controlled choice, so a freshly-set goal can be
-- shown immediately instead of waiting for the next week.
--
-- Existing goals start hidden (default false): admins opt in per goal.
alter table public.retros
  add column if not exists goal_shown boolean not null default false;

-- Setting a goal: surface it automatically the FIRST time a goal is
-- given (empty -> non-empty). Later edits preserve the admin's show/hide
-- choice; clearing the goal hides it again.
create or replace function public.set_retro_goal(p_retro_id uuid, p_goal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_is_live boolean;
  v_prev_goal text;
  v_new_goal text;
begin
  select team_id, is_live, goal into v_team_id, v_is_live, v_prev_goal
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

  v_new_goal := coalesce(p_goal, '');

  update public.retros
    set goal = v_new_goal,
        goal_set_by = auth.uid(),
        goal_updated_at = now(),
        goal_shown = case
          when v_new_goal = '' then false                  -- cleared: hide
          when coalesce(v_prev_goal, '') = '' then true    -- first set: show
          else goal_shown                                  -- edit: keep choice
        end
    where id = p_retro_id;
end;
$$;

grant execute on function public.set_retro_goal(uuid, text) to authenticated;

-- Admin toggle for the show flag, independent of the goal text and of
-- is_live — so admins can pin or unpin a past retro's goal as a current
-- goal too, not only the live one.
create or replace function public.set_retro_goal_shown(p_retro_id uuid, p_shown boolean)
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
    raise exception 'Only team admins can change goal visibility';
  end if;

  update public.retros
    set goal_shown = coalesce(p_shown, false)
    where id = p_retro_id;
end;
$$;

grant execute on function public.set_retro_goal_shown(uuid, boolean) to authenticated;
