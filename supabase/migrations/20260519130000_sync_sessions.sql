-- Synchronized pomodoro sessions

create table if not exists public.sync_sessions (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  leader_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid null references public.teams (id) on delete set null,

  -- Timer state (mirrors user_pomodoro_state)
  mode text not null default 'work'
    check (mode in ('work', 'shortBreak', 'longBreak')),
  sessions int not null default 0,
  is_running boolean not null default false,
  remaining_seconds int not null default 1500,
  ends_at timestamptz null,

  -- Session lifecycle
  status text not null default 'active'
    check (status in ('active', 'ended')),
  max_participants int not null default 10,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz null
);

create index sync_sessions_join_code_active on public.sync_sessions (join_code) where status = 'active';
create index sync_sessions_leader_active on public.sync_sessions (leader_id) where status = 'active';

-- Generate 6-char uppercase alphanumeric join code
create or replace function public.generate_sync_join_code()
returns text
language sql
as $$
  select upper(substr(replace(replace(
    encode(extensions.gen_random_bytes(4), 'base64'),
    '+', ''), '/', ''), 1, 6));
$$;

-- Auto-compute ends_at (same pattern as user_pomodoro_state)
create or replace function public.sync_session_set_ends_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_running and new.remaining_seconds is not null then
    new.ends_at := pg_catalog.now() + (new.remaining_seconds * interval '1 second');
  else
    new.ends_at := null;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists tr_sync_session_ends_at on public.sync_sessions;
create trigger tr_sync_session_ends_at
  before insert or update on public.sync_sessions
  for each row
  execute function public.sync_session_set_ends_at();

-- Realtime
alter table public.sync_sessions replica identity full;
alter publication supabase_realtime add table public.sync_sessions;

-- Participants

create table if not exists public.sync_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sync_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  unique (session_id, user_id)
);

create index sync_participants_session_active on public.sync_session_participants (session_id) where left_at is null;
create index sync_participants_user_active on public.sync_session_participants (user_id) where left_at is null;

alter table public.sync_session_participants replica identity full;
alter publication supabase_realtime add table public.sync_session_participants;

-- RLS: sync_sessions

alter table public.sync_sessions enable row level security;

create policy "Participants can read session"
  on public.sync_sessions for select
  using (
    auth.uid() = leader_id
    or exists (
      select 1 from public.sync_session_participants p
      where p.session_id = id
        and p.user_id = auth.uid()
        and p.left_at is null
    )
  );

create policy "Auth users create sessions"
  on public.sync_sessions for insert
  with check (auth.uid() = leader_id);

create policy "Leader updates session"
  on public.sync_sessions for update
  using (auth.uid() = leader_id)
  with check (auth.uid() = leader_id);

create policy "Leader deletes session"
  on public.sync_sessions for delete
  using (auth.uid() = leader_id);

-- RLS: sync_session_participants

alter table public.sync_session_participants enable row level security;

create policy "Participants read members"
  on public.sync_session_participants for select
  using (
    exists (
      select 1 from public.sync_session_participants me
      where me.session_id = sync_session_participants.session_id
        and me.user_id = auth.uid()
        and me.left_at is null
    )
  );

create policy "Users join sessions"
  on public.sync_session_participants for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sync_sessions s
      where s.id = session_id
        and s.status = 'active'
        and (select count(*) from public.sync_session_participants p
             where p.session_id = s.id and p.left_at is null) < s.max_participants
    )
  );

create policy "Users leave sessions"
  on public.sync_session_participants for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RPC: join sync session by code

create or replace function public.join_sync_session(p_join_code text, p_display_name text default '')
returns json
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_participant public.sync_session_participants;
  v_count int;
begin
  select * into v_session
    from public.sync_sessions
    where join_code = upper(p_join_code)
      and status = 'active';

  if not found then
    return json_build_object('error', 'Session not found or has ended');
  end if;

  select count(*) into v_count
    from public.sync_session_participants
    where session_id = v_session.id and left_at is null;

  if v_count >= v_session.max_participants then
    return json_build_object('error', 'Session is full');
  end if;

  insert into public.sync_session_participants (session_id, user_id, display_name)
    values (v_session.id, auth.uid(), p_display_name)
    on conflict (session_id, user_id)
    do update set left_at = null, joined_at = now(), display_name = excluded.display_name
    returning * into v_participant;

  return json_build_object(
    'session', row_to_json(v_session),
    'participant', row_to_json(v_participant)
  );
end;
$$;
