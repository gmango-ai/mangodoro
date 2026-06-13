-- Task segments: per-clock-in slices of "what was I working on".
--
-- Today an entry captures one clock-in/out window with a single
-- description. Real days bounce between tasks — code review, then a
-- meeting, then back to a feature. This table records each task slice
-- as it happens so the log can roll up "what did I finish today"
-- without the user having to remember.
--
-- Lifecycle:
--   * On clock-in (or first task switch), insert a segment with
--     started_at = now(), ended_at = null, entry_id = null.
--   * Switching task closes the current open segment (ended_at = now())
--     and inserts a new one.
--   * On clock-out, close the current open segment and link every
--     open-during-this-session segment to the new entry row.
--
-- description is just text for now — ClickUp / project mapping comes
-- later. Empty description is allowed (clock-in without naming a task
-- yet), but the UI should encourage naming it.

create table if not exists public.task_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete set null,
  description text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists task_segments_user_started_idx
  on public.task_segments (user_id, started_at desc);

-- Find the currently open segment fast (zero or one row per user).
create unique index if not exists task_segments_user_open_idx
  on public.task_segments (user_id) where ended_at is null;

-- Link segments to their parent entry once it exists.
create index if not exists task_segments_entry_idx
  on public.task_segments (entry_id) where entry_id is not null;

alter table public.task_segments enable row level security;

drop policy if exists "Users manage own task_segments" on public.task_segments;
create policy "Users manage own task_segments"
  on public.task_segments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── RPCs ─────────────────────────────────────────────────────────

-- start_task_segment: closes any open segment for this user and
-- inserts a new open one. Returns the new segment's id.
create or replace function public.start_task_segment(p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.task_segments
  set ended_at = v_now
  where user_id = auth.uid() and ended_at is null;
  insert into public.task_segments (user_id, description, started_at)
  values (auth.uid(), coalesce(trim(p_description), ''), v_now)
  returning id into v_new_id;
  return v_new_id;
end;
$$;

grant execute on function public.start_task_segment(text) to authenticated;

-- update_open_task_segment: rename the currently open segment without
-- closing it. Used when the user is editing the description in place
-- after starting tracking with an empty placeholder.
create or replace function public.update_open_task_segment(p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.task_segments
  set description = coalesce(trim(p_description), '')
  where user_id = auth.uid() and ended_at is null;
end;
$$;

grant execute on function public.update_open_task_segment(text) to authenticated;

-- stop_task_segment: close the open segment without starting a new
-- one. Used on clock-out.
create or replace function public.stop_task_segment()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.task_segments
  set ended_at = now()
  where user_id = auth.uid() and ended_at is null;
end;
$$;

grant execute on function public.stop_task_segment() to authenticated;

-- link_segments_to_entry: after the client creates an entry on
-- clock-out, attach every still-unlinked segment from the past N
-- hours (default 24, enough for a long shift but bounded so a
-- segment from a previous session doesn't get attached).
create or replace function public.link_segments_to_entry(
  p_entry_id uuid,
  p_since timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '24 hours');
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Confirm the entry belongs to the caller; otherwise refuse.
  if not exists (
    select 1 from public.entries
    where id = p_entry_id and user_id = auth.uid()
  ) then
    raise exception 'Entry not found';
  end if;
  with linked as (
    update public.task_segments
    set entry_id = p_entry_id
    where user_id = auth.uid()
      and entry_id is null
      and started_at >= v_since
    returning 1
  )
  select count(*) into v_count from linked;
  return v_count;
end;
$$;

grant execute on function public.link_segments_to_entry(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
