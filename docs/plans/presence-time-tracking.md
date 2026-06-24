# Plan — Clock-in presence, work summaries, timezones, quick lunch

Ties **presence ↔ the existing clock ↔ profiles** together. Almost everything
reuses primitives that already exist:

| Need | Already exists |
| --- | --- |
| The work clock | `clockIn` in AppContext (`{start, breaks, activeBreak, billable}`), persisted to `user_settings.active_clock`, cross-device synced. `handleClockIn` / `handleClockOut` / `clockedElapsed` / `breakElapsed`. |
| Paid/unpaid breaks | `entries.breaks` jsonb items already carry `unpaid`; the live clock's `activeBreak` → break on stop. |
| What you're working on | `task_segments` (open segment = current task) + `start/stop_task_segment`. |
| Week totals | `get_my_week_minutes`. |
| Timezone | `profiles.timezone` (IANA) column — present but unpopulated. |
| Presence | `presence_state` + sync participants + the shared `presence.js` vocabulary. |

**Decisions locked:** work-hour summaries are **admin + self** visibility. "Who's
working" is an inherently team-visible roster (only clocked-in *status* + current
task are shared; the break detail in `active_clock` stays private).

---

## Phase 0 — Foundations (small, unblocks the rest)
- **Capture timezone:** on load, if `profiles.timezone` is empty, set it from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` (one-time, silent).
- **Working hours:** add `work_start` / `work_end` to `user_settings` (the
  canonical "typical hours"). The wellbeing-reminder active-hours can default
  from these. Used by availability + the hover card.
- **Lunch break setting:** `lunch_break_paid` bool (default false = unpaid) — the
  default for the quick On-lunch break.

## Phase 1 — Clock-in presence + quick On-lunch + "who's working"
- **Office clock-in:** surface `handleClockIn`/`handleClockOut` in the hallway +
  room (a Clock in / Clock out button), reading the existing AppContext clock —
  no new clock, just a second entry point. Clocking in optionally seeds the
  current `task_segment` description.
- **Team-visible work status:** a small `work_status` table (`user_id, team_id,
  clocked_in_at, on_break, task`) teammates can read (RLS = same team). Upsert on
  clock-in / break / clock-out. This is the public projection of the private
  `active_clock`.
- **Presence wiring:** clocked-in ⇒ a "Working" presence read; on-break ⇒ reflect
  the break (lunch/away). Surfaced via the existing presence dots.
- **"On lunch" button (new):** one tap → (a) presence `out_to_lunch`, (b) start an
  `activeBreak` on the clock with `unpaid = !lunch_break_paid`, (c) set the
  `lunch_until` auto-return timer (reuse LunchReminder). "Back" ends the break.
  So a lunch is logged into the day's entry automatically, paid or unpaid.
- **"Working now" widget:** a roster (office + maybe nav) of who's clocked in,
  their task, and elapsed — "see who is currently working."
- **(Optional) honesty guard:** if clocked in but tab hidden / no activity for N
  minutes, prompt "still working?" and auto-pause so logged hours stay accurate.

## Phase 2 — Profile work summaries (admin + self)
- **RPC `get_user_work_summary(p_user_id)`** — gated to `p_user_id = auth.uid()`
  OR caller in `get_my_admin_team_ids()`. Returns today / this week / streak /
  avg start time / focus-vs-break split (over `entries` + `task_segments`).
- **Profile page:** a "Work summary" card — your own always; others only when
  you're a team admin.
- **Hover card:** a compact "Xh today · Yh week" line when permitted.

## Phase 3 — Timezone awareness + availability
- **Hover card:** local time (from `profiles.timezone`) + working-hours window +
  an "almost offline / off-hours" badge, so you don't assign someone clocking off.
- **Warnings:** a soft "they're outside working hours" hint when you @mention or
  assign someone past their `work_end`.
- **(Optional) Team timezone strip:** everyone's local time at a glance, marking
  who's inside vs outside their window.

---

## Notifications that fall out of this
- "Teammate clocked in" (start-of-day awareness) — a new trigger type.
- Commuting / Lunch optionally silence your *own* desktop pops (light DND).
- End-of-day "wrap up & clock out" reminder (pairs with working hours; uses the
  wellbeing-reminder framework).

## Migrations (new)
`work_status` table + RLS; `user_settings` add `work_start`/`work_end`/
`lunch_break_paid`; `get_user_work_summary` RPC; (later) clocked-in notification
trigger. Profiles.timezone already exists.

## Open question
Working hours vs the wellbeing-reminder "active hours" — make `work_start/end`
canonical and have reminders default from it (recommended), or keep them
separate. Leaning: one source of truth (`work_start/end`).
