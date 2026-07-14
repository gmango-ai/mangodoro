-- Google OAuth refresh-token storage.
--
-- Google's provider_token (access token) that Supabase hands back at sign-in is
-- short-lived (~1h) and Supabase doesn't auto-refresh it, so users kept having
-- to re-auth for Calendar / Docs. Google DOES issue a refresh token (the sign-in
-- already asks for access_type=offline + prompt=consent) — we now capture it and
-- keep it here so the `google-token` edge function can mint fresh access tokens
-- server-side without any user interaction.
--
-- The refresh token is sensitive (long-lived), so the client may WRITE its own
-- row but cannot READ it back (no select policy); only the edge function
-- (service role) reads it.
create table if not exists public.google_oauth_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_oauth_tokens enable row level security;

create policy "got_insert_own" on public.google_oauth_tokens
  for insert with check (user_id = auth.uid());
create policy "got_update_own" on public.google_oauth_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Intentionally NO select policy: the client writes but never reads the token.
