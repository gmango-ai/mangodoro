-- Per-participant status string for sync sessions ("Designing", "On a call", …)

alter table public.sync_session_participants
  add column if not exists status text not null default '',
  add column if not exists status_updated_at timestamptz;

create or replace function public.set_sync_participant_status(
  p_session_id uuid,
  p_status text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text;
begin
  -- Trim and cap length to keep the row tiny
  v_clean := coalesce(substring(trim(p_status) from 1 for 80), '');

  update public.sync_session_participants
    set status = v_clean,
        status_updated_at = now()
    where session_id = p_session_id
      and user_id = auth.uid()
      and left_at is null;

  if not found then
    return json_build_object('error', 'You are not an active participant');
  end if;

  return json_build_object('ok', true, 'status', v_clean);
end;
$$;

notify pgrst, 'reload schema';
