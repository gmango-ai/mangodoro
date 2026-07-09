-- Status-system rewrite, P0 (docs/plans/status-system-rewrite.md).
-- Additive + CHECK-widening only — no data remap, no behavior change yet.
-- Prepares user_presence for the 7-state vocabulary (online/focusing/meeting/
-- lunch/commuting/away/offline) and the new manual + liveness columns, while
-- STILL allowing the legacy 9-state values so nothing breaks mid-transition.
-- P1 tightens the CHECK to the new 7 and remaps existing rows.

-- New columns — all nullable or safe-defaulted.
alter table public.user_presence
  add column if not exists last_seen_at   timestamptz,                     -- heartbeat; the server sweep reads this
  add column if not exists auto_pin_until timestamptz,                     -- while > now(), idle->away won't override manual intent
  add column if not exists invisible      boolean not null default false,  -- appear offline to teammates (self still sees real)
  add column if not exists override_emoji text;                           -- emoji beside the status message

-- Widen availability CHECKs to the UNION of legacy(9) + new(online, meeting)
-- so BOTH vocabularies validate during the transition.
alter table public.user_presence drop constraint if exists user_presence_availability_check;
alter table public.user_presence add constraint user_presence_availability_check
  check (availability in ('available','pairing','focusing','in_meeting','away','lunch','commuting','off','offline',
                          'online','meeting'));

alter table public.user_presence drop constraint if exists user_presence_override_availability_check;
alter table public.user_presence add constraint user_presence_override_availability_check
  check (override_availability is null or override_availability in
         ('available','pairing','focusing','in_meeting','away','lunch','commuting','off','offline',
          'online','meeting'));

notify pgrst, 'reload schema';
