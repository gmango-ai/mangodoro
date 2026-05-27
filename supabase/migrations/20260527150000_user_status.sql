-- Phase 5: Global user status integrated across the app.
--
-- Adds status / presence_state / status_updated_at to user_settings,
-- plus a setter RPC. Realtime is already enabled on user_settings
-- (see 20260519170000_user_settings_realtime.sql), so changes broadcast
-- to all this user's tabs/devices instantly.

alter table public.user_settings
  add column if not exists status text not null default '',
  add column if not exists presence_state text not null default 'active'
    check (presence_state in ('active', 'away', 'in_meeting', 'heads_down', 'available')),
  add column if not exists status_updated_at timestamptz;

-- Auto-stamp status_updated_at when status or presence_state changes.
create or replace function public.user_settings_touch_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if
    new.status is distinct from old.status
    or new.presence_state is distinct from old.presence_state
  then
    new.status_updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists tr_user_settings_touch_status on public.user_settings;
create trigger tr_user_settings_touch_status
  before update on public.user_settings
  for each row
  execute function public.user_settings_touch_status();

-- Setter RPC. Either field may be omitted (pass null).
create or replace function public.set_user_status(
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
begin
  if p_presence_state is not null
     and p_presence_state not in ('active', 'away', 'in_meeting', 'heads_down', 'available') then
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
    -- Row doesn't exist yet (new user). Create one.
    insert into public.user_settings (user_id, status, presence_state)
      values (
        auth.uid(),
        coalesce(v_clean, ''),
        coalesce(p_presence_state, 'active')
      )
      on conflict (user_id) do update set
        status = case when p_status is not null then v_clean else public.user_settings.status end,
        presence_state = coalesce(p_presence_state, public.user_settings.presence_state);
  end if;

  return json_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
