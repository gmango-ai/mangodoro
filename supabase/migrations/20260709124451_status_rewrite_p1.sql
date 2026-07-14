-- Status-system rewrite, P1 (docs/plans/status-system-rewrite.md).
-- Remap existing rows from the legacy 9-state vocabulary to the new 7 and
-- tighten the CHECKs. The resolver now emits the 7 (online/focusing/meeting/
-- lunch/commuting/away/offline); the write layer (userPresence.js) normalizes,
-- so only these values reach the table from here on.

-- Fold old availability values into the new 7.
update public.user_presence set availability = case availability
  when 'available' then 'online'
  when 'pairing'   then 'online'
  when 'in_meeting' then 'meeting'
  when 'off'       then 'offline'
  else availability end
where availability in ('available','pairing','in_meeting','off');

update public.user_presence set override_availability = case override_availability
  when 'available' then 'online'
  when 'pairing'   then 'online'
  when 'in_meeting' then 'meeting'
  when 'off'       then 'offline'
  else override_availability end
where override_availability in ('available','pairing','in_meeting','off');

-- Tighten both CHECKs to exactly the new 7.
alter table public.user_presence drop constraint if exists user_presence_availability_check;
alter table public.user_presence add constraint user_presence_availability_check
  check (availability in ('online','focusing','meeting','lunch','commuting','away','offline'));

alter table public.user_presence drop constraint if exists user_presence_override_availability_check;
alter table public.user_presence add constraint user_presence_override_availability_check
  check (override_availability is null or override_availability in
         ('online','focusing','meeting','lunch','commuting','away','offline'));

notify pgrst, 'reload schema';
