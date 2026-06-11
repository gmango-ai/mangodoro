-- Core app tables originally created out-of-band in Supabase.
-- This baseline lets `supabase db reset --linked` bootstrap a fresh project.

-- ── templates ────────────────────────────────────────────────

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  start text,
  end_time text,
  breaks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index templates_user_id_idx on public.templates (user_id);

alter table public.templates enable row level security;

create policy "Users read own templates"
  on public.templates for select
  using (auth.uid() = user_id);

create policy "Users insert own templates"
  on public.templates for insert
  with check (auth.uid() = user_id);

create policy "Users update own templates"
  on public.templates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own templates"
  on public.templates for delete
  using (auth.uid() = user_id);

-- ── projects ─────────────────────────────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  client_name text not null default '',
  color text not null default '#14b8a6',
  created_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

create policy "Users read own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users insert own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users update own projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ── entries ──────────────────────────────────────────────────

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  start text,
  end_time text,
  description text not null default '',
  minutes integer not null default 0,
  breaks jsonb not null default '[]'::jsonb,
  project_ids uuid[] not null default '{}'::uuid[],
  billable boolean not null default true
);

create index entries_user_id_date_idx on public.entries (user_id, date);

alter table public.entries enable row level security;

create policy "Users read own entries"
  on public.entries for select
  using (auth.uid() = user_id);

create policy "Users insert own entries"
  on public.entries for insert
  with check (auth.uid() = user_id);

create policy "Users update own entries"
  on public.entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own entries"
  on public.entries for delete
  using (auth.uid() = user_id);

-- ── user_settings ────────────────────────────────────────────

create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  default_start text,
  default_end text,
  default_template_id uuid references public.templates (id) on delete set null,
  hourly_rate numeric not null default 0,
  deepseek_key text,
  reminder_time text,
  time_rounding text not null default 'none',
  daily_target numeric not null default 0,
  weekly_target numeric not null default 0,
  default_entry_mode text not null default 'manual',
  active_clock jsonb,
  google_access_token text,
  google_token_expiry bigint,
  updated_at timestamptz not null default now(),
  constraint user_settings_user_id_key unique (user_id)
);

alter table public.user_settings enable row level security;

create policy "Users read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own settings"
  on public.user_settings for delete
  using (auth.uid() = user_id);
