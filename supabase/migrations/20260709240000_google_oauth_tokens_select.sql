-- Follow-up to 20260709230000: add an own-rows SELECT policy to
-- google_oauth_tokens.
--
-- The original table had no select policy (to keep the refresh token
-- server-only), but the client stores its token with the default
-- return=representation, which runs INSERT ... RETURNING and checks the returned
-- row against the SELECT policy — with none, every write failed RLS (42501) and
-- the refresh token was never captured. Grant own-rows select: no new exposure,
-- since the client already holds its own refresh token (it comes from the
-- Supabase session's provider_refresh_token before we persist it). The edge
-- function still reads via the service role.
create policy "got_select_own" on public.google_oauth_tokens
  for select using (user_id = auth.uid());
