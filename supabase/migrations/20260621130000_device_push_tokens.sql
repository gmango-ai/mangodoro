-- Per-device APNs token for SILENT background pushes.
-- Distinct from pomodoro_activity_tokens (which are per-Live-Activity push
-- tokens from ActivityKit): this is the app's standard remote-notification
-- device token. The server sends a content-available background push to it
-- whenever the shared pomodoro state changes, so the iOS app can refresh the
-- App Group + reload the home-screen widget even while backgrounded — keeping
-- the home widget from showing stale state when the timer is driven from
-- another device (web / desktop). One row per (user, device).
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  push_token text not null,
  apns_env text not null default 'production'
    check (apns_env in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists device_push_tokens_user_idx
  on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

create policy "Owner reads own device tokens"
  on public.device_push_tokens for select
  using (auth.uid() = user_id);

create policy "Owner inserts own device tokens"
  on public.device_push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Owner updates own device tokens"
  on public.device_push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owner deletes own device tokens"
  on public.device_push_tokens for delete
  using (auth.uid() = user_id);

create or replace function public.device_push_tokens_touch()
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

drop trigger if exists tr_device_push_tokens_touch on public.device_push_tokens;
create trigger tr_device_push_tokens_touch
  before update on public.device_push_tokens
  for each row
  execute function public.device_push_tokens_touch();
