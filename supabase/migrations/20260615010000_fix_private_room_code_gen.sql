-- Fix: the sync_session_room_side_effects trigger called
-- pg_catalog.gen_random_bytes which doesn't exist there — pgcrypto
-- lives in the `extensions` schema on Supabase, and our search_path is
-- forced to '' so the unqualified form doesn't resolve either.
-- Switch to pg_catalog.gen_random_uuid (built-in, always present) and
-- slice 6 hex chars off it. 16M possible codes, more than enough for
-- invite-code uniqueness; the rooms_invite_code_unique partial index
-- still guards against collisions.

create or replace function public.sync_session_room_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_code text;
begin
  if new.room_id is null then return new; end if;
  select * into v_room from public.rooms where id = new.room_id;
  if v_room is null then return new; end if;

  -- Auto-expire for meeting rooms.
  if v_room.kind = 'meeting'
     and v_room.max_duration_minutes is not null
     and new.expires_at is null then
    new.expires_at := pg_catalog.now()
                    + (v_room.max_duration_minutes * interval '1 minute');
  end if;

  -- Lock private rooms on first join. 6-char uppercase hex from a v4
  -- UUID. If a collision happens (rooms_invite_code_unique throws),
  -- the join itself fails and the user can retry — they'll get a
  -- fresh UUID on the second attempt.
  if v_room.kind = 'private' and v_room.invite_code is null then
    v_code := upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6));
    update public.rooms set invite_code = v_code where id = v_room.id;
  end if;

  return new;
end;
$$;
