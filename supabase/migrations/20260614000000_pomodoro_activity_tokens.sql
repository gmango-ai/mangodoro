-- Per-Live-Activity push token + per-activity HMAC secret.
-- One row per active iOS Live Activity instance. The widget extension
-- looks up its row by activity_id and authenticates with the raw
-- secret (whose SHA256 is stored as secret_hash). The edge function
-- uses the push_token to send an APNs Live Activity update so the
-- lockscreen UI changes immediately when the user taps a button.
create table if not exists public.pomodoro_activity_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_id text not null unique,
  push_token text not null,
  secret_hash text not null,
  apns_env text not null default 'production'
    check (apns_env in ('production', 'sandbox')),
  state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists pomodoro_activity_tokens_user_active_idx
  on public.pomodoro_activity_tokens (user_id)
  where ended_at is null;

alter table public.pomodoro_activity_tokens enable row level security;

create policy "Owner reads own tokens"
  on public.pomodoro_activity_tokens for select
  using (auth.uid() = user_id);

create policy "Owner inserts own tokens"
  on public.pomodoro_activity_tokens for insert
  with check (auth.uid() = user_id);

create policy "Owner updates own tokens"
  on public.pomodoro_activity_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owner deletes own tokens"
  on public.pomodoro_activity_tokens for delete
  using (auth.uid() = user_id);

create or replace function public.pomodoro_activity_tokens_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists tr_pomodoro_activity_tokens_touch on public.pomodoro_activity_tokens;
create trigger tr_pomodoro_activity_tokens_touch
  before update on public.pomodoro_activity_tokens
  for each row
  execute function public.pomodoro_activity_tokens_touch();
