-- Per-user work summary for the profile (presence/time-tracking phase 2).
-- Readable for yourself, or by an admin of a team the target belongs to
-- (the "admins + self" visibility decision). Aggregates the entries log.

create or replace function public.get_user_work_summary(p_user_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_today int; v_week int; v_month int; v_days int; v_streak int := 0;
  v_avg numeric; d date;
  v_week_start date := date_trunc('week', current_date)::date;
begin
  if not (
    p_user_id = auth.uid()
    or exists (
      select 1 from public.team_members me
      join public.team_members them on them.team_id = me.team_id
      where me.user_id = auth.uid() and me.role = 'admin' and them.user_id = p_user_id
    )
  ) then
    raise exception 'Not permitted';
  end if;

  select coalesce(sum(minutes), 0)::int into v_today
    from public.entries where user_id = p_user_id and date = current_date;
  select coalesce(sum(minutes), 0)::int into v_week
    from public.entries where user_id = p_user_id and date >= v_week_start and date < v_week_start + 7;
  select coalesce(sum(minutes), 0)::int into v_month
    from public.entries where user_id = p_user_id and date >= date_trunc('month', current_date)::date;
  select count(distinct date)::int into v_days
    from public.entries where user_id = p_user_id and date >= v_week_start and date < v_week_start + 7 and minutes > 0;

  -- Typical start: average of the entry start time (HH:MM) over the last 30 days.
  select avg((split_part(start, ':', 1))::int * 60 + (split_part(start, ':', 2))::int) into v_avg
    from public.entries
    where user_id = p_user_id and date >= current_date - 30 and minutes > 0
      and start ~ '^[0-2]?[0-9]:[0-5][0-9]$';

  -- Streak: consecutive days with logged time, counting back from today (or
  -- yesterday if today isn't logged yet, so an unstarted today doesn't break it).
  d := current_date;
  if not exists (select 1 from public.entries where user_id = p_user_id and date = d and minutes > 0) then
    d := current_date - 1;
  end if;
  while exists (select 1 from public.entries where user_id = p_user_id and date = d and minutes > 0) loop
    v_streak := v_streak + 1;
    d := d - 1;
  end loop;

  return json_build_object(
    'today_minutes', v_today,
    'week_minutes', v_week,
    'month_minutes', v_month,
    'days_this_week', v_days,
    'streak_days', v_streak,
    'avg_start_min', case when v_avg is null then null else round(v_avg)::int end
  );
end; $$;
grant execute on function public.get_user_work_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
