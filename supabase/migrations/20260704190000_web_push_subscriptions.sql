-- web_push_subscriptions: browser Push API subscriptions (one per device/browser
-- per user). The client subscribes via pushManager.subscribe() and upserts the
-- endpoint + keys here; the web-push edge function reads them (service role) and
-- sends VAPID-signed pushes so notifications arrive even when the app is closed.

create table if not exists public.web_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists web_push_subs_user on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;

-- Owner manages their own subscriptions. The edge function reads across users
-- via the service role (bypasses RLS).
drop policy if exists "owner manages own web push subs" on public.web_push_subscriptions;
create policy "owner manages own web push subs"
  on public.web_push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
