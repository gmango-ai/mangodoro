-- Onboarding / tutorial state, stored per-account as a single jsonb blob so
-- adding a new tutorial later is a code-only change (no per-tour column churn).
-- Shape (all optional, defaults handled client-side):
--   {
--     "welcomeDone":    bool,       -- saw the first-run welcome panel
--     "completedTours": string[],   -- tour ids the user finished
--     "dismissedTours": string[],   -- tour ids the user chose "not now" on (still replayable)
--     "checklist":      { [id]: true }, -- getting-started items marked done
--     "seenTourMarker": string      -- newest "new feature" tour marker acknowledged (WhatsNew-style)
--   }
-- Own-row RLS from the base schema already covers read/update, so no new policy.
alter table public.user_settings
  add column if not exists onboarding jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
