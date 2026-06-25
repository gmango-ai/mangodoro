-- Add a "Commuting" presence state (commuting) — "driving / travelling, can't
-- respond", more specific than Away. Widen the two presence_state CHECK
-- constraints + the two setter RPCs so it's accepted everywhere the existing
-- states are. See 20260623150000 for the prior (out_to_lunch) version.

alter table public.user_settings
  drop constraint if exists user_settings_presence_state_check;
alter table public.user_settings
  add constraint user_settings_presence_state_check
    check (presence_state in ('active', 'away', 'in_meeting', 'heads_down', 'available', 'out_to_lunch', 'commuting'));

create or replace function public.set_user_status(
  p_status text default null,
  p_presence_state text default null
)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_clean text;
begin
  if p_presence_state is not null
     and p_presence_state not in ('active', 'away', 'in_meeting', 'heads_down', 'available', 'out_to_lunch', 'commuting') then
    return json_build_object('error', 'Invalid presence_state');
  end if;

  v_clean := case
    when p_status is null then null
    else coalesce(substring(trim(p_status) from 1 for 80), '')
  end;

  update public.user_settings
    set status = case when p_status is not null then v_clean else status end,
        presence_state = coalesce(p_presence_state, presence_state)
    where user_id = auth.uid();

  if not found then
    insert into public.user_settings (user_id, status, presence_state)
      values (auth.uid(), coalesce(v_clean, ''), coalesce(p_presence_state, 'active'))
      on conflict (user_id) do update set
        status = case when p_status is not null then v_clean else public.user_settings.status end,
        presence_state = coalesce(p_presence_state, public.user_settings.presence_state);
  end if;

  return json_build_object('ok', true);
end;
$$;

alter table public.sync_session_participants
  drop constraint if exists sync_session_participants_presence_state_check;
alter table public.sync_session_participants
  add constraint sync_session_participants_presence_state_check
    check (presence_state in ('active', 'away', 'in_meeting', 'heads_down', 'available', 'out_to_lunch', 'commuting'));

create or replace function public.set_sync_participant_status(
  p_session_id uuid,
  p_status text default null,
  p_presence_state text default null
)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_clean text;
  v_presence text;
begin
  v_clean := coalesce(substring(trim(coalesce(p_status, '')) from 1 for 80), '');
  v_presence := nullif(p_presence_state, '');

  if v_presence is not null
     and v_presence not in ('active', 'away', 'in_meeting', 'heads_down', 'available', 'out_to_lunch', 'commuting') then
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

notify pgrst, 'reload schema';
