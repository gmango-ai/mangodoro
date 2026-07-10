# Status system — targeted rewrite

**Goal:** easily share your current status with coworkers (with a message linked to it),
have it propagate instantly across every surface and stay synced across devices, and have it
integrate honestly with presence (auto away/offline), rooms, pomodoro, and chat.

**Decision (2026-07-09):** targeted rewrite — keep the pure, tested resolver core
(`statusResolver.js` / `presenceSignals.js`, ~116 tests) and the `user_presence` table;
delete the legacy vocabulary + write fan-out + duplicated maps around them.

## Locked design decisions

1. **Scope:** targeted rewrite (keep resolver core + `user_presence`; rebuild plumbing + consolidate stores).
2. **Taxonomy:** clean 7 — `online, focusing, meeting, lunch, commuting, away, offline`.
   `pairing` and `off` are demoted to *activity detail* (e.g. "Pairing with Sam"), not top-level states.
3. **Auto vs manual:** `away` (idle) overrides a manual status **unless pinned**; `offline`
   (disconnected) always wins. Pin = "keep my status", stored as `auto_pin_until = now + 24h`,
   auto-expires after a day.
4. **Invisible:** a manual "appear offline" is supported (self sees real state; teammates see offline).

## Why (root causes from the audit)

- **Fan-out writes, no owner.** Each resolver tick writes to 5 uncoordinated targets
  (localStorage, `user_presence`, `user_settings` RPC, `sync_session_participants` RPC, plus
  `work_status` + a realtime presence channel). None transactional/retried; a failed write plus
  an unchanged next signature strands the state → "update here, other surfaces don't sync".
- **Two vocabularies.** New 9-state `availability` vs legacy 7-state `presence_state`, bridged by
  client-only maps in ≥3 places; `pairing` lost in translation.
- **6+ duplicated state→(color,label) maps**, several wrong (available renders sky in 3 components,
  emerald in the canonical one; OfficeMinimap knows only 5 states).
- **No real liveness.** `online` is hardcoded `true` in `useResolvedSelf`; no `beforeunload`,
  `navigator.onLine`, sleep detection, multi-tab leader, or server sweep — so offline-on-close/sleep
  cannot work (a dead client can't report its own death).

## Target data model

**`user_presence` is the ONLY status truth any surface reads.** Extend it; stop reading/writing
status from `user_settings.presence_state` and `sync_session_participants.presence_state/status`
(leave those columns for now, drop in a later migration). `work_status` stays as the time-clock
fact but becomes a *signal into* the resolver, not a status surface.

New/changed columns on `user_presence`:
- `availability` CHECK → **7-state** (`online, focusing, meeting, lunch, commuting, away, offline`).
- `override_availability` (nullable, 7-state) — manual intent.
- `override_message` (text) + `override_emoji` (text) — the message linked to status (settable with or
  without changing availability).
- `override_expires_at` (timestamptz) — optional auto-clear ("back at 3").
- `auto_pin_until` (timestamptz) — while `> now`, idle→away does NOT override manual intent.
- `invisible` (boolean, default false) — appear offline to teammates.
- `last_seen_at` (timestamptz) — heartbeat; the server sweep uses this.
- keep: `since, activity_label, activity_link, activity_since, activity_private, location_kind, location_room_id`.

Enum remap migration: `available→online`, `pairing→online` (+ activity), `in_meeting→meeting`,
`off→offline`; `focusing/lunch/commuting/away/offline` unchanged. Remap both `availability` and
`override_availability`. (Shared live DB — apply via MCP `apply_migration`, fresh timestamp, never edit applied.)

## Resolver (keep pure; extend)

Output enum → 7-state. Precedence (highest wins):

1. **Offline (disconnected)** — no heartbeat / `navigator.onLine === false` / pagehide. For teammates,
   the server sweep sets `availability = offline` when `last_seen_at` is stale.
2. **Away (idle)** — beyond threshold (5m from online, 18m from focusing; meeting never idles away),
   UNLESS `auto_pin_until > now`.
3. **Manual override** — `override_availability` if set and not expired.
4. **Environmental** — meeting room→meeting, pomodoro/focus room→focusing, clock lunch→lunch,
   commuting signal→commuting.
5. **Online** — present / clocked-in / active.
6. **Offline** — no presence.

`message`/`emoji` render regardless of which layer wins. `invisible` is a *presentation filter*
applied at read time for non-self viewers (render offline), orthogonal to the resolver.
Wire the real `online` signal into `presenceSignals` (currently unused / hardcoded).

## Write + liveness layer (the rewrite)

- **Single owner + leader election.** New `PresenceService` (reuse the BroadcastChannel pattern in
  `SyncSessionContext`): only the leader tab runs the tick, heartbeat, and a *single* idempotent
  `user_presence` upsert (with retry-on-failure; don't early-return when the last write errored).
  Followers relay through the channel + realtime. Fixes per-tab idle divergence + duplicate writes.
- **Client liveness:** `online`/`offline` events, `navigator.onLine`, `visibilitychange`, and a
  best-effort `pagehide`/`sendBeacon` for snappy tab-close.
- **Remove** the legacy write-through (`updateStatus` → `set_user_status`; `setStatus` →
  `set_sync_participant_status`) from the presence path.
- **Server sweep** (pg_cron or edge fn, ~60s): set `availability = offline` where `last_seen_at`
  is stale; clear `override_*` past `override_expires_at`; clear `auto_pin_until` past now.

## Consumers (unify)

- **One `presence.js` map:** `{ key, label, dot, ring, light }` per 7 states. Delete all duplicates in
  StatusSetter, ParticipantCards, RoomMembersWidget, OfficeMinimap, SyncParticipantList, SettingsPage.
- **One roster path:** self via `useResolvedSelf`; teammates via a single realtime subscription on
  `user_presence` (team-scoped). Migrate every surface: StatusChip, Nav dot, pomodoro StatusSetter +
  ParticipantCards, RoomMembersWidget, OfficeMinimap, RoomTile, OfficePresenceBar, SyncParticipantList,
  ProfileCard, chat/DM dots.
- **Invisible** handled at read for non-self viewers.

## Integrations

- **Rooms:** entering a meeting/focus room is an environmental signal (already partly wired); in-room
  member lists read `user_presence`, not the participant `presence_state` column.
- **Pomodoro:** work sprint → focusing signal (exists); FocusTaskPanel "Set as status" and the pomodoro
  StatusSetter become thin wrappers over the one override API.
- **Chat:** DM/conversation dots read the same `user_presence`; the **interruptibility light**
  (green/amber/red/grey) drives DND (focusing/meeting suppress non-urgent) via the notification layer.

## Additions beyond the ask

- Status **message + emoji + optional expiry** ("🎯 heads down til 3", auto-clears).
- Interruptibility **light → DND** in chat/notifications.
- **Server-side offline reconciliation** so the notification router doesn't depend on an open client.
- **Activity privacy** enforced server-side (RLS/column) rather than client redaction only.

## Phasing (each phase shippable + testable)

- **P0 — Vocabulary + map.** Migration: 7-state enum remap + new columns. Single `presence.js` map;
  delete duplicates. No behavior change beyond vocabulary. Update resolver tests to the 7-state names.
- **P1 — Resolver.** 7-state output, wire real `online`, precedence with pin/away/offline. Extend tests.
- **P2 — Single-owner writes.** `PresenceService` + leader election + heartbeat; remove legacy dual-writes.
- **P3 — Server sweep.** Offline stale + override/pin expiry (edge fn / cron).
- **P4 — Consumers.** Migrate every surface to the one store + one map; delete legacy reads.
- **P5 — Manual UI.** Status picker (availability + message + emoji + expiry), pin toggle, appear-offline;
  wire nav chip + pomodoro StatusSetter to the one API.
- **P6 — Integrations + cleanup.** DND light → notifications; chat dots; privacy enforcement; drop dead
  legacy columns/RPCs (`set_user_status`, `set_sync_participant_status`, legacy `presence_state`).

## Risks / notes

- **Shared live DB** across branches (memory [[supabase-migrations-shared-db]]): fresh migration
  timestamps, apply via MCP `apply_migration`, never edit an applied migration.
- **RLS history** of "members see each other as Member" — keep `user_presence` SELECT = self + teammates;
  test a non-teammate can't read.
- Keep the pure resolver PURE (no I/O) so the 116 tests stay meaningful; all I/O in `PresenceService`.
- Migrate consumers behind the shared map first so a half-migrated tree still renders consistent colors.
