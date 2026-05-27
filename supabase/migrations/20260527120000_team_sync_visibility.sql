-- Phase 1: Surface running team pomodoros to teammates.
--
-- Adds a `visibility` column on sync_sessions ('team' | 'invite_only')
-- and additive RLS so team members can see their team's active sessions
-- and the participants of those sessions, without joining first.

-- ── Column: visibility ──────────────────────────────────────────
alter table public.sync_sessions
  add column if not exists visibility text not null default 'team'
  check (visibility in ('team', 'invite_only'));

-- Partial index for the team-discovery query.
create index if not exists idx_sync_sessions_team_active
  on public.sync_sessions (team_id)
  where status = 'active' and visibility = 'team';

-- ── RLS: team members can read team-visible active sessions ─────
drop policy if exists "Team members read team sessions" on public.sync_sessions;
create policy "Team members read team sessions"
  on public.sync_sessions for select
  using (
    status = 'active'
    and visibility = 'team'
    and team_id is not null
    and team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    )
  );

-- ── RLS: team members can read participants of those sessions ───
drop policy if exists "Team members read team session participants"
  on public.sync_session_participants;
create policy "Team members read team session participants"
  on public.sync_session_participants for select
  using (
    exists (
      select 1
      from public.sync_sessions s
      join public.team_members tm on tm.team_id = s.team_id
      where s.id = sync_session_participants.session_id
        and s.status = 'active'
        and s.visibility = 'team'
        and tm.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
