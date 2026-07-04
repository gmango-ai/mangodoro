# Status ↔ Notification Integration

**Status:** Draft / in design — 2026-07-03
**Thesis:** Several presence-adjacent systems were each built on their own (rooms/LiveKit, realtime presence, `status`/`presence_state`, clock + `task_segments`, pomodoro, notifications). The status feature is underused not because its UI is bad, but because it is one of *four* disconnected representations of "what are you doing / can I reach you," and it does nothing once set. This effort turns status into the **connective tissue** between those systems, and rebuilds the notification layer so it can act on status.

The whole thing reduces to **two integration seams**:

```
Rooms/LiveKit ─┐
Realtime presence ─┤
Clock / task_segments ─┤→  ①  STATUS RESOLVER  →  one resolved status object
Pomodoro ─┤        (client-side; reads all          (availability + location + activity)
Calendar (later) ─┘         signals; override wins)         │  (coarse snapshot persisted)
                                                            ▼
                                          ②  NOTIFICATION PIPELINE
                                             (event → route by status×priority → deliver)
```

Get ① and ② right and the systems stop needing pairwise (N²) wiring — they all feed the resolver and read the delivery policy.

---

## 1. Current state (what exists today)

Four overlapping representations, none referencing each other:

| Concept | Storage | Fed by |
|---|---|---|
| `status` (text, 80ch) + `presence_state` (7-value enum) + `status_updated_at` | `user_settings`, **duplicated** on `sync_session_participants` | `set_user_status` RPC, hand-edited (`StatusSetter`, `StatusBlock`) |
| `work_status` (`clocked_in_at`, `on_break`, `task`, `team_id`) | `work_status` table | clock-in system, auto (`PresenceSync`) |
| `task_segments` (`description`, `started_at`, `ended_at`) | `task_segments` table | clock-in / task switch, auto |
| Online/offline liveness | Supabase realtime channel `team-presence:{teamId}` | socket (`useTeamPresence`, `PresenceSync`) |

- `presence_state` enum: `active | available | heads_down | in_meeting | away | out_to_lunch | commuting`.
- **No pomodoro→status coupling exists** today — it only *feels* pomodoro-locked because `StatusSetter` lives on the pomodoro surface and `StatusBlock` is buried in the Electron popover.
- Notification layer: `notifications` table (`recipient_user_id`, `actor_user_id`, `type`, `title`, `body`, `payload`, `team_id`, `entity_type/id`, `channels[]`, `dedupe_key`, `read_at`) + `emit_notification` RPC + `notification_preferences` (per-type/user) + `notification_follows` (`kind='focus_start'`, scaffolded, unused) + `user_settings.notif_quiet_start/end` + `notif_desktop_enabled`. Desktop delivery is effectively Electron-only.

### Problems
1. Hand-typed `status` is decoupled from what the app already knows (`task_segments`, clock, room, pomodoro) → instantly stale → worse than nothing.
2. The 7-state enum conflates *interruptibility* with *reason*; nobody remembers which to pick, and states like `commuting`/`in_meeting` have no trigger.
3. No always-visible place to set it (pomodoro surface or settings only).
4. It's passive — gates nothing, notifies no one. Zero payoff for keeping it current.
5. Notifications can't express priority or react to focus, and don't reach browser (non-Electron) users.

---

## 2. Design principles

- **Derive availability, confirm activity.** *Availability* (how interruptible) is derived from reliable **environmental signals** (where you are, room mode, idle, calendar, car Bluetooth). *Activity* (what you're working on) is **not guessed** — it's a cheap manual confirm (paste a link, pick a recent). We only auto-derive what we can actually know.
- **Manual override always wins**, with an optional expiry ("until 3pm").
- **Rooms are the backbone, not the exception.** Being in a LiveKit call is the *normal working state* (remote presence), not "in a meeting."
- **General is the default; modes are opt-in.** Don't force every room into a rigid type.
- **Status de-fragments rooms** — an office-wide roster spanning all rooms answers "who can I go talk to."
- **Extend, don't fork, the sound + push systems** already in the codebase.

---

## 3. Seam ① — The Status Resolver

A **client-side** resolver reads every signal source, computes one `ResolvedStatus`, and persists a **coarse snapshot** to a server-visible table (throttled, on meaningful change only — keeps DB writes low per the reduce-db-calls concern). Everyone (roster, room sidebar, nav chip, avatars) and the notification router read that snapshot.

### 3.1 Resolved status shape
```
ResolvedStatus {
  availability: 'available' | 'pairing' | 'focusing' | 'in_meeting'
              | 'away' | 'lunch' | 'commuting' | 'off' | 'offline'
  light:   'green' | 'yellow' | 'red' | 'grey'     // derived from availability
  location: { kind: 'room'|'huddle'|'none', roomId?, roomName?, roomMode? }
  activity: { label?, link?, kind?: 'pairing'|'task'|'manual', since? }
  source:  'derived' | 'override'
  override?: { availability, message?, expiresAt? }
  since:   timestamp   // when the current availability started
}
```
Traffic-light mapping (the question teammates actually ask — "can I ping them?"):
`available`→🟢 · `pairing`→🟡 · `focusing`/`in_meeting`→🔴 · `away`/`lunch`/`commuting`/`off`/`offline`→⚪.
The existing 7 enum values survive as the derived vocabulary — but each now **earns its keep by having a real trigger** (below).

### 3.2 Signal priority stack (highest wins; all under manual override)

| # | Signal (existing or new) | Resolves to |
|---|---|---|
| 1 | **Manual override** (optional expiry) | anything |
| 2 | **Idle / walked away from desk** (`IdlePresence`, exists) | ⚪ Away *(overlay — stickiness depends on the state it overrides; see idle rules below)* |
| 3 | **Calendar event now** (Phase 3) | 🔴 In a meeting |
| 4 | **Room kind = meeting** *(exists today)* | 🔴 In a meeting |
| 5 | **Car Bluetooth connected** (mobile, Phase 2+) | ⚪ Commuting |
| 6 | **Clock: on lunch / break / clocked out** (`work_status`) | ⚪ Lunch / Away / Off |
| 7 | **Room kind = focus (new), OR pomodoro work block running** (`user_pomodoro_state`) | 🔴 Focusing |
| 8 | **In a general room / clocked in / at desk & not idle; pairing → 🟡** | 🟢 Available |
| 9 | Realtime presence only (tab open) | 🟢 Available *(idle overlay downgrades to Away; no separate "online" state)* |
| 10 | No presence | ⚪ Offline |

**Idle downgrade rules (Q2 resolved).** Idle is not a flat overlay — from input-idle alone we can't tell "listening quietly" from "walked away," so a false Away is worse than a stale busy. How deliberate the overridden state is decides how much idle can move it:

| Current state | Idle behavior |
|---|---|
| **Meeting** (meeting-mode room / active calendar event) | **Never** idles to Away — committed until you leave / it ends |
| **Focusing (derived** — pomodoro / focus room) | Idles to Away only after a **long** threshold (~15–20m); deep work has quiet stretches |
| **Available / general / at-desk** | Standard short threshold (~5m, current behavior) |
| **Any manual override** (asserted heads-down/DND) | Sticky — never idles away; you said so on purpose |

The `source` field (`derived` vs `override`) is what lets "pomodoro says focus" idle-away on a long timer while "I clicked focus" stays put.

**General-room ladder (Q3 resolved — no per-room "vibe").** In a general room, status falls through to a predictable per-person ladder; the room does *not* force one status, and there is **no** second per-room knob beyond `mode`:

1. Manual override
2. Pomodoro work running → 🔴 Focusing
3. Pairing (2-person, active) → 🟡 "Pairing with X" *(busy but reachable)*
4. Else → 🟢 Available

If a room needs to impose a collective default, that is precisely what `focus`/`social` modes are for — one knob, not two.

### 3.3 Storage consolidation
Replace the scattered writes with one canonical, server-visible snapshot table (name TBD, e.g. **`user_presence`**):
`user_id, availability, activity_label, activity_link, activity_since, location_room_id, location_kind, override_availability, override_message, override_expires_at, since, updated_at`.
- **Source signals stay put** (`work_status`, `task_segments`, `user_pomodoro_state`) — they feed the resolver, not the roster.
- **Realtime channel stays** for online/offline liveness only.
- **Availability *transitions* bypass the write-throttle (Q1).** Entering/leaving focus (or any availability change) writes immediately so the notification router's snapshot is fresh within seconds; only activity-label churn is throttled. This is what keeps server-side routing decisions correct.
- `sync_session_participants.status` becomes a room-scoped override or is derived; `user_settings.status`/`presence_state` deprecated in favor of the override fields on `user_presence` (migration shim mirrors during transition).

---

## 4. Room kinds — extend the existing enum (do NOT add a parallel column)

**Reality check (found in code):** rooms already have `public.room_kind` = `general | meeting | private` (originally `department`, renamed to `general` in migration `20260615000000`). Meeting rooms already carry `max_duration_minutes` + auto-expiry; `private` rooms already have invite-code locking. So the earlier "add `rooms.mode`" idea was wrong — we **extend the existing `room_kind` enum** with the status vibes rather than introduce a second knob (which also honors Q3's "one knob" rule). The resolver already handles all these kinds today; the new values just won't *occur* until the enum + create-room UI allow them.

- **meeting** *(exists)* → derived 🔴 In a meeting; add the locked/restricted layout forcing the video tile dominant (hooks into the modular BSP room layout).
- **private** *(exists)* → access control (invite code), orthogonal to the status vibe — stays as-is; derives status from occupants' per-person signals like general.
- **focus** *(new value)* → quiet room; derived 🔴 Focusing by default.
- **break** *(new value)* → the water-view ambient-camera room; ☕ "open to chat" (available/social, not away) — the roster surfaces them as chattable, fixing "break room hides people."
- **social** *(new value)* → biases toward 🟢 available/chatty.
- **general** *(exists, default)* → imposes nothing; defers to the per-person ladder (§3.2).

Access-gating (dept/org-team) is already a separate mechanism (`room_teams`), so focus/break/social rooms can be gated without needing `kind=private`. The enum extension is a small additive `alter type … add value`, deferred to Phase 1b.

---

## 5. Surfaces (where status lives)

- **Office-wide roster** spanning every room — always see everyone, which room/huddle they're in, availability light + activity + duration. This is what solves findability/fragmentation.
- **Room sidebar status section** — the widget sidebar gets a dedicated status block: see the room's occupants' statuses, set your own inline.
- **Always-visible nav status chip** — avatar-ring light + activity + duration; click to edit anywhere. Kills "hidden in settings."
- **Avatars everywhere** carry the light ring + tooltip.

### Activity (tier-0, no ClickUp integration required)
- **Paste a link** (ClickUp task, GitHub PR, Figma, doc) → chip: *"Working on: PR #123 · 47m"*.
- **Quick-pick from recents** — `task_segments` already logs history; usually one tap.
- Duration is free (`task_segments.started_at`).
- Forward path: swap the manual paste for a real ClickUp/GitHub picker in the same UI slot later.
- **Privacy — hide detail, never availability (Q4 resolved).** Privacy applies only to the activity label/link, so it degrades gracefully: public *"🔴 Focusing · on PR #123 · 47m"* → private *"🔴 Focusing · 47m"* (busy + duration still shown; teammates always know *whether* you're reachable). Per-activity lock toggle, **shared-by-default**, choice remembered per source. Auto-private for sensitive sources (e.g. HR spaces) is a v2. Room-name visibility rides the existing `entry_policy`/room-privacy rules — non-members of a locked room see just "in a room."

---

## 6. Huddles & pairing (in scope)

Two things that are **activities/relationships, not places**, so they shouldn't require a room:

- **Pairing** — derive "Pairing with X" when exactly two people share a room with screens/cams active. No dedicated room needed.
- **1:1 huddle** — a Slack-huddle direct-call primitive: call one person, no room spun up. **Status-aware**: if the callee is 🔴 Focusing/In-meeting, the huddle arrives as a **knock/request** (reuse the existing room-knock semantics) instead of barging in; if 🟢, it rings through. Being in a huddle is itself a status/location.

This is the clearest demonstration of the two seams working together: the resolver says whether to knock or ring; the notification pipeline delivers it at the right priority.

---

## 7. Seam ② — Notification pipeline rebuild

**Decision: full rebuild** of the schema and routing (chosen), splitting the conflated "event vs delivery," while **migrating existing types so behavior is preserved** before new behavior is layered on.

### 7.1 New schema
- **`notification_events`** — one row per thing that happened.
  `id, actor_user_id, team_id, type, priority ('low'|'normal'|'high'|'urgent'), title, body, payload jsonb, entity_type, entity_id, dedupe_key, created_at`.
- **`notification_deliveries`** — one row per (event × recipient); the per-person envelope with lifecycle.
  `id, event_id fk, recipient_user_id, state ('pending'|'delivered'|'held'|'read'|'dismissed'), priority (inherited), channels_targeted text[], held_reason, delivered_at, read_at, created_at`.
  Recipients' realtime subscription + inbox read from **this** table (RLS: recipient reads own). Replaces the current `notifications` read path.
- **`notification_channel_prefs`** — per-user × per-type × per-channel enablement + the focus-delivery config.
  Channels: `inapp`, `desktop` (Electron), `web_push` (browser), `sound`, (`email` future).

### 7.2 Emit → Route → Deliver (split)
- **Emit** (`emit_event` RPC): insert one `notification_events` row (with dedupe); fan out to recipients (single / follow-set / room / team) by inserting `notification_deliveries` rows.
- **Route** (server, in emit or trigger): for each delivery compute `channels_targeted` from `priority × channel prefs × quiet hours × the recipient's current coarse availability` (read from `user_presence`, §3.3). Decide **deliver / hold / silent**; set `state`.
- **Deliver** (client + push service): subscribe to `notification_deliveries`; render in-app; fire desktop/web-push; play sound per policy. Closed-tab/offline delivery via **web-push through a service worker + push edge function reading `device_push_tokens`** (reuse the `device-register` infra pomodoro already uses).
- **Decision locus (Q1 resolved) — split by channel, not a compromise.** The hold-vs-deliver decision for **push channels (web-push, desktop) is server-authoritative** — when a tab is closed there is no client present, so only the router can decide whether to fire a push at all. The **in-app banner + sound is client last-mile** — on receipt with the tab open, the client re-checks *live* status and may suppress (or upgrade) even if the server said "deliver," because it has the freshest state. Each channel is decided where it has the freshest applicable signal, and the two layers cover the emit-vs-transition race (a ping emitted in the split-second before a focus transition is written still gets muted client-side).

### 7.3 Focus-aware delivery policy (the payoff)
*(your availability) × (priority) → action*:

| | 🟢 Available | 🔴 Focusing | 🔴 In meeting | ⚪ Away |
|---|---|---|---|---|
| low/normal | banner + sound | **hold** | **hold** | hold |
| high | banner + sound | banner, **no sound** | hold | banner |
| urgent | banner + sound | banner + sound | banner + sound | banner + sound |

**Held** deliveries queue and **flush as a digest when availability leaves focus** (the one genuinely new subsystem). Sound is gated by *(focus × priority)* and reconciled with the existing sound-cue system on the current branch (no parallel sound stack).

### 7.4 New event types this unlocks
`status_became_free` (via `notification_follows` — "ping me when Jek's free") · `focus_started` · `lunch_return` (exists) · `huddle_knock` / `huddle_incoming` · `pairing_invite` · `calendar_event_starting` (Phase 3).

### 7.5 Preferences UX
One unified settings surface: per-type, per-priority, quiet hours, focus-delivery behavior, channel toggles (incl. browser-push permission flow).

---

## 8. Calendar integration (Phase 3 — biggest lift)

Google Calendar OAuth + edge function + token storage/refresh. Two payoffs:
1. **Availability signal** — a "busy" event happening now → 🔴 In a meeting (Event Name); can pre-arm focus DND.
2. **Room orchestration** — bind an event to a room by title rule or explicit link (*"Standup" → Meeting Room A*, *"SWE review" → SWE room*). At start time, deep-link attendees into the bound room and flip status. The `rooms.mode` field is the connective tissue.

---

## 9. Data-model changes (migrations — new timestamps, never reuse)

- Extend `public.room_kind` enum with `focus`, `break`, `social` (additive `alter type … add value`; existing `general|meeting|private` stay). **No** parallel `mode` column. *(Phase 1b)*
- **`user_presence`** table (coarse resolved snapshot; RLS: co-member readable, owner writes). Server router + roster read this. ✅ **built** — migration `20260703120000_user_presence.sql`.
- **`notification_events`**, **`notification_deliveries`**, **`notification_channel_prefs`** tables; `emit_event` / route function; migrate existing `notification*` types and read paths; keep old `notifications` readable during transition (shim), then drop.
- `notification_events.priority` + per-type default function.
- (Phase 2) huddle/pairing plumbing. (Phase 3) calendar tokens + event↔room bindings.

*Note: one shared DB across branches — every new migration needs a fresh timestamp; `db push` silently skips timestamp collisions. Never edit an applied migration in place.*

---

## 10. Phasing

**Phase 1 — the loop end-to-end (v1, chosen "both together"):**
- **1a. Notification pipeline rebuild**, behavior-preserving first: new `events`/`deliveries`/`channel_prefs` schema, emit/route/deliver split, migrate existing types + read paths. Land quietly, no new UX.
- **1b. Status resolver + storage consolidation** (`user_presence`), room `mode`, and surfaces (office-wide roster, room-sidebar status, nav chip, avatar rings) — from signals you already have.
- **1c. Connect the seams:** priority dimension + focus-aware delivery policy + hold/return-digest + **browser web-push**. This is the moment status starts to *matter*.

**Phase 2 — direct-calling:** 1:1 huddle primitive (no room) + pairing auto-detection + status-aware knock, wired into ① and ②. Mobile car-Bluetooth → commuting (needs mobile app).

**Phase 3 — Google Calendar:** availability signal + event↔room orchestration.

**Cross-cutting:** unified notification preferences UX; sound reconciliation with the current sound-cue system.

---

## 11. Resolved decisions

1. **Decision locus (Q1) — RESOLVED.** Hybrid, split by channel: push = server-authoritative (only place it can be decided when no client is present); in-app banner/sound = client last-mile (freshest status). Availability *transitions* bypass the write-throttle so the router's snapshot stays fresh. See §3.3, §7.2.
2. **Idle-as-overlay (Q2) — RESOLVED.** Idle stickiness scales with how deliberate the overridden state is: meeting = never idles to Away; derived focus = Away only after a long (~15–20m) threshold; ambient available = standard (~5m); any manual override = sticky. Principle: never falsely claim you left a meeting. See §3.2.
3. **General-room "vibe" (Q3) — RESOLVED: no per-room vibe.** One knob (`mode`). General rooms defer to a predictable per-person ladder (override → pomodoro/focusing → pairing/🟡 → available). A room that needs a collective default uses `focus`/`social` mode. See §3.2, §4.
4. **Activity privacy (Q4) — RESOLVED.** Privacy hides the activity *detail* only, never availability/duration; degrades to "🔴 Focusing · 47m." Per-activity lock, shared-by-default, remembered per source. Room-name visibility rides existing room-privacy. See §5.

Through-line: the system always tells the truth about *whether* you're reachable, and is conservative about claiming detail — it won't falsely say you left a meeting (Q2) and won't leak what you're doing (Q4), but never hides that you're busy.

## 12. Remaining risks / open

- **Migrating a live notification system** is the biggest blast radius — 1a lands behaviorally-equivalent first; needs a dual-write/dual-read shim + a cutover checklist.
- **Web-push reliability** across browsers/OS (Safari/iOS quirks) — scope a fallback (in-app + desktop-Electron stay; web-push best-effort).
- **`user_presence` staleness bound** — confirm the throttle + transition-bypass keeps routing correct under rapid state flips; define a max acceptable age.
- **Pairing-detection heuristic** — "2 people + active screens" can misfire (a 2-person room that's really a mini-meeting); confirm the signal + a manual correct/override.
- **Auto-private activity sources** (HR spaces etc.) deferred to v2.

---

## 13. Build log

Branch: `feat/status-notification-integration` (off `origin/main` — local `main` was far behind).

**Increment 1 — resolver foundation (done, non-breaking):**
- `supabase/migrations/20260703120000_user_presence.sql` — the resolved-snapshot table (co-member RLS like `work_status`, realtime, touch trigger). *Not yet pushed to the shared DB.*
- `src/lib/presence.js` — extended with the unified availability vocabulary (`AVAILABILITY_LIGHT/LABEL/DOT/RING`, `legacyToAvailability`) alongside the untouched legacy `PRESENCE_*` maps.
- `src/lib/statusResolver.js` — the pure `resolveStatus(signals)`; priority stack + idle rules (Q2) + general-room ladder (Q3) + override + activity/privacy passthrough (Q4). `src/lib/statusResolver.test.js` — 27 tests.

**Increment 2 — write path (done, non-breaking):**
- `src/lib/presenceWrite.js` — pure `presenceSignature` + `shouldWritePresence` (transition-bypass vs activity throttle, §3.3/Q1). `src/lib/presenceWrite.test.js` — 9 tests.
- `src/lib/userPresence.js` — I/O over the table: `upsertUserPresence` (redacts private activity at write time), `setPresenceOverride`/`clearPresenceOverride`, `getMyPresence`, `listTeamPresence`.

**Increment 3 — resolver→write glue (done, INERT / not mounted):**
- `src/lib/presenceSignals.js` — pure `buildSignals(ctx, now)` mapping AppContext/SyncSession/pomodoro/idle onto the Signals contract. `src/lib/presenceSignals.test.js` — 8 tests incl. end-to-end buildSignals→resolveStatus.
- `src/components/PresenceResolver.jsx` — mount-once glue (matches IdlePresence): snapshots context → buildSignals → resolveStatus → shouldWritePresence → upsertUserPresence, on a 15s tick, tracking `since`. **Deliberately NOT rendered in `App.jsx`** — stays inert until go-live.
- Signal accessors confirmed: `useApp()` (session/settings/clockIn/currentTask), `useTeam()` (activeTeamId/rooms), `useSyncSession()` (syncSession.room_id → rooms.find → kind), `usePomodoro()` (isRunning/mode), `localStorage["mango:lastActivity"]`.
- Full suite: **98 tests green**, no regressions.

**Increment 4 — read side + first surface (done, INERT):**
- `src/lib/utils.js` — `formatSince(start, now?)` (+ `utils.test.js`).
- `src/hooks/useResolvedSelf.js` — live self resolved status (context + idle + 15s heartbeat); `PresenceResolver` refactored onto it (one computation shared by display + persistence).
- `src/components/StatusChip.jsx` — the always-visible self status chip (light + label + activity + duration); client-state only, no DB — but **not mounted in `Nav.jsx`** yet.
- `src/lib/officePresence.js` — pure `mergeOfficePresence(rows, online)` (snapshot × liveness overlay; offline forcing; private redaction; legacy fallback) · `officePresence.test.js` — 5 tests.
- `src/hooks/useOfficePresence.js` — refcounted singleton realtime roster over `user_presence` (mirrors `useClockedIn`) → `mergeOfficePresence`. **Not consumed** by any surface yet.
- Full suite: **108 tests green**; new JSX/hooks esbuild-clean.

**Increment 5 — mounts + presence-timeline verification tool (done):**
- Mounted `<PresenceResolver />` in `App.jsx` (beside IdlePresence/PresenceSync) and `<StatusChip />` in `Nav.jsx` desktop bar (next to WorkClockBar).
- **Presence timeline** (requested, to verify detection): `src/lib/presenceTimeline.js` (pure `presenceClass`/`appendSample`/`computeTotals`/`todayKey`, gap-as-offline; `presenceTimeline.test.js` — 8 tests) · `src/hooks/usePresenceTimeline.js` (`recordPresenceSample` called from PresenceResolver's tick = records all-day, DB-free; `usePresenceTimeline` read view) · `src/components/profile/ProfilePresenceTimeline.jsx` (segmented active/away/offline bar + totals) mounted self-only in `ProfilePage.jsx`.
- Full suite: **116 tests green**; production build clean.

**Go-live — remaining (only the shared-DB touch is left):**
1. **`supabase db push`** the `20260703120000_user_presence.sql` migration to the shared DB. *(user is running this)* Until then, the writer's upserts fail best-effort (no crash); StatusChip + the presence timeline already work (client-side only).
2. Smoke-test live: own chip tracks room/pomodoro/idle; the profile presence timeline fills in; a teammate's `user_presence` row appears via `useOfficePresence`. Then commit.

**Still deferred:** status-setter UI + override wiring; office roster surface consuming `useOfficePresence`; `alter type room_kind add value 'focus'/'break'/'social'`; the notification rebuild (Phase 1a); pairing/car-BT/calendar signals.

**Deferred:** `alter type room_kind add value 'focus'/'break'/'social'` (Phase 1b); status-setter UI + override wiring; pairing/car-BT/calendar signals; the notification rebuild (Phase 1a).
