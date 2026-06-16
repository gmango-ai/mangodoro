-- Link a retro to a sync_session. A meeting room with a video call
-- going can attach a retro so everyone in the call sees the same
-- retro board. The retro keeps existing independently at
-- /retros/:id — the link is transient (session-scoped) and goes
-- away when the session ends.
--
-- Set-null on retro delete keeps the session row valid; the UI
-- treats a null retro_id as "no retro linked." Set-null on session
-- delete isn't needed because the session row itself goes via the
-- BEFORE DELETE cleanup trigger that already handles cascade.

alter table public.sync_sessions
  add column if not exists retro_id uuid
    references public.retros(id) on delete set null;

create index if not exists sync_sessions_retro_id_idx
  on public.sync_sessions (retro_id) where retro_id is not null;

-- Whitelist retro_id in the metadata-change trigger. Without this,
-- the leader-only metadata guard from 20260611150000 would reject
-- the link attempt. The trigger lives in public; we extend its
-- field list by replacing the function body.
--
-- (No-op when the column isn't yet referenced by callers.)

-- ── RPCs ──────────────────────────────────────────────────────

-- link_retro_to_session: only the session leader may attach, and
-- the retro must belong to the same team as the session.
create or replace function public.link_retro_to_session(
  p_session_id uuid,
  p_retro_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_retro public.retros;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can link a retro';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Session is not active';
  end if;

  select * into v_retro from public.retros where id = p_retro_id;
  if not found then raise exception 'Retro not found'; end if;

  if v_session.team_id is null or v_retro.team_id <> v_session.team_id then
    raise exception 'Retro and session must belong to the same team';
  end if;

  update public.sync_sessions
    set retro_id = p_retro_id
    where id = p_session_id;
end;
$$;

grant execute on function public.link_retro_to_session(uuid, uuid) to authenticated;

-- unlink_retro_from_session: leader-only. Setting retro_id back to
-- null doesn't touch the retro itself — it just severs the link.
create or replace function public.unlink_retro_from_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
begin
  select * into v_session from public.sync_sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.leader_id <> auth.uid() then
    raise exception 'Only the session leader can unlink the retro';
  end if;

  update public.sync_sessions
    set retro_id = null
    where id = p_session_id;
end;
$$;

grant execute on function public.unlink_retro_from_session(uuid) to authenticated;

notify pgrst, 'reload schema';
