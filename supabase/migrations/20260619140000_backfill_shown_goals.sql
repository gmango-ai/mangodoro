-- One-off backfill: after retro_goal_shown defaulted existing goals to
-- hidden, re-surface the MOST RECENT goal for each "tag" — i.e. per
-- department (org_team_id) and team-wide (org_team_id is null) — so the
-- latest goal each tag set shows again in the pomodoro / office displays.
update public.retros r
set goal_shown = true
where coalesce(r.goal, '') <> ''
  and r.id = (
    select r2.id
    from public.retros r2
    where r2.team_id = r.team_id
      and r2.org_team_id is not distinct from r.org_team_id
      and coalesce(r2.goal, '') <> ''
    order by coalesce(r2.goal_updated_at, r2.created_at) desc nulls last, r2.id desc
    limit 1
  );
