-- Profile pictures + structured presence for sync participants.

-- ── user_settings: avatar_url ────────────────────────────────
alter table public.user_settings
  add column if not exists avatar_url text;

-- ── sync_session_participants: avatar_url + presence_state ───
alter table public.sync_session_participants
  add column if not exists avatar_url text,
  add column if not exists presence_state text not null default 'active'
    check (presence_state in ('active', 'away', 'in_meeting'));

-- ── join_sync_session now snapshots avatar_url from user_settings ──
create or replace function public.join_sync_session(
  p_join_code text,
  p_display_name text default ''
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sync_sessions;
  v_participant public.sync_session_participants;
  v_avatar text;
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

  -- Snapshot the user's current avatar so we don't have to cross-read
  -- user_settings (RLS would block it for cross-user reads).
  select avatar_url into v_avatar
    from public.user_settings
    where user_id = auth.uid();

  insert into public.sync_session_participants
    (session_id, user_id, display_name, avatar_url)
    values (v_session.id, auth.uid(), p_display_name, v_avatar)
    on conflict (session_id, user_id)
    do update set
      left_at = null,
      joined_at = now(),
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url
    returning * into v_participant;

  return json_build_object(
    'session', row_to_json(v_session),
    'participant', row_to_json(v_participant)
  );
end;
$$;

-- ── set_sync_participant_status now takes presence_state too ──
create or replace function public.set_sync_participant_status(
  p_session_id uuid,
  p_status text default null,
  p_presence_state text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
  v_presence text;
begin
  v_clean := coalesce(substring(trim(coalesce(p_status, '')) from 1 for 80), '');
  v_presence := nullif(p_presence_state, '');

  if v_presence is not null and v_presence not in ('active', 'away', 'in_meeting') then
    return json_build_object('error', 'Invalid presence_state');
  end if;

  update public.sync_session_participants
    set status = case when p_status is not null then v_clean else status end,
        presence_state = coalesce(v_presence, presence_state),
        status_updated_at = now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  if not found then
    return json_build_object('error', 'You are not an active participant');
  end if;

  return json_build_object('ok', true);
end;
$$;

-- ── refresh_my_sync_avatar: lets the client push a new avatar to
--    every active session row they're in after updating user_settings ──
create or replace function public.refresh_my_sync_avatar()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sync_session_participants p
    set avatar_url = us.avatar_url,
        display_name = coalesce(us.name, p.display_name)
    from public.user_settings us
    where p.user_id = auth.uid()
      and us.user_id = auth.uid()
      and p.left_at is null;
$$;

-- ── Storage bucket for avatars (idempotent) ──────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    true,
    2097152, -- 2 MB
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS: any authenticated user can read public avatars (public bucket already
-- allows anonymous GET via signed/public URLs). Users can write/replace/delete
-- only files under their own user_id prefix.

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars: users write own" on storage.objects;
create policy "avatars: users write own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars: users update own" on storage.objects;
create policy "avatars: users update own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars: users delete own" on storage.objects;
create policy "avatars: users delete own"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

notify pgrst, 'reload schema';
