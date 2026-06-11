# Pomodoro Robustness — Implementation Plan

**Goal:** Make the pomodoro timer reliable across all user flows — solo, multi-tab, multi-device, sync sessions, background tabs, refresh, and PiP.

**Status:** Not started  
**Last updated:** 2026-06-11

---

## Background

The timer is mostly server-anchored (`ends_at` in Postgres + Supabase Realtime), which is the right foundation. Desync comes from split authority: timer logic, UI, session lifecycle, and preferences live in different places with different rules.

### Root causes (summary)

| # | Issue | Severity |
|---|-------|----------|
| 1 | Multiple `PomodoroTimer` mounts → duplicate state and Realtime subscriptions | High |
| 2 | Session membership (`App.jsx`) decoupled from timer state (`PomodoroTimer.jsx`) | High |
| 3 | `BroadcastChannel("pomodoro")` posted but never listened to | High |
| 4 | `JoinSyncPage` does not fire `ql-sync-session-joined` (same-tab invite broken) | High |
| 5 | Phase completion is client-side only (controller must be awake) | High |
| 6 | `toggleRun` passes stale `secondsLeft` closure to server | Medium |
| 7 | Durations and auto-transition stored in localStorage only | Medium |
| 8 | All sync participants fire sound/notification at zero | Medium |
| 9 | Fallback sync is reactive (`visibilitychange` only), not proactive while running | Medium |

### Target architecture

```
┌─────────────────────────────────────────────────────────┐
│  SyncSessionCoordinator (App-level)                     │
│    · rehydrate ql_sync_session                          │
│    · BroadcastChannel + CustomEvent listeners           │
│    · participants, presence, join/leave/end               │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  PomodoroEngine (Context + hook) — ONE per browser      │
│    · derive display from ends_at                        │
│    · single setInterval ticker                          │
│    · intent-based writes                                │
│    · Realtime subscription (solo or sync)               │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   Floating panel   PomodoroPage      PiP portal
   (presentation)   (presentation)    (presentation)
```

### Design principles

1. **One timer engine per browser** — shared via React Context, not per-component state.
2. **Derive display, don't duplicate it** — running: `remaining = f(ends_at, now)`; paused: `remaining_seconds`.
3. **Write intents, not snapshots** — `start()`, `pause()`, `reset()`, not raw field patches.
4. **Server owns phase transitions in sync mode** — clients observe; controller triggers or DB advances.
5. **Session coordinator owns membership** — timer engine consumes `syncSession` from one place.

---

## Phase 0 — Quick wins (no schema change)

**Scope:** Fix highest-impact bugs without restructuring.  
**Risk:** Low  
**Depends on:** Nothing

### 0.1 BroadcastChannel listener

- [x] Add a persistent `BroadcastChannel("pomodoro")` listener in `App.jsx`
- [x] On `{ type: "sync-changed" }`, re-read `ql_sync_session` from localStorage
- [x] Fetch active `sync_sessions` row and call `setSyncSession`
- [x] If session ID cleared or session ended, call existing leave/teardown path
- [ ] Verify: join in tab B → tab A updates within ~1s without refresh

**Files:** `src/App.jsx`

### 0.2 JoinSyncPage session event

- [x] After successful join in `JoinSyncPage`, dispatch `ql-sync-session-joined` with `{ session: data.session }` (match `TeamPage` / `PomodoroPage`)
- [x] Keep existing `localStorage.setItem("ql_sync_session", …)` and `navigate("/pomodoro")`
- [ ] Verify: open invite link in same tab while app is already open → session + participants appear immediately

**Files:** `src/pages/JoinSyncPage.jsx`

### 0.3 Fix stale `secondsLeft` on pause/resume

- [x] In `toggleRun`, derive `remaining_seconds` from `endsAtMsRef` when running, else `latestRef.current.secondsLeft`
- [x] Audit other `flushToServer` call sites for stale closure values
- [ ] Verify: rapid pause after background tab → server row matches UI

**Files:** `src/components/PomodoroTimer.jsx`

### 0.4 Gate sync completion alerts

- [x] Only call `playCompletionSound` and `Notification` when `!isSynced || isController`
- [x] Followers still update phase via Realtime (no local sound)
- [ ] Verify: 3 participants in sync → only controller hears alarm

**Files:** `src/components/PomodoroTimer.jsx`

### 0.5 Completion double-fire guard

- [x] Add `completionHandledRef` keyed on `(mode, sessions, ends_at)` or equivalent
- [x] Reset guard when a new phase starts or timer is reset
- [ ] Verify: completion effect does not fire twice on re-render at `secondsLeft === 0`

**Files:** `src/components/PomodoroTimer.jsx`

### 0.6 Proactive poll while running

- [x] While `is_running`, refetch timer row every 30s (solo: `user_pomodoro_state`; sync: `sync_sessions`)
- [x] Apply via existing `applyRemoteRow` (no force unless drift > 3s)
- [x] Clear interval on pause/unmount
- [ ] Verify: disable WebSocket 30s → timer recovers without tab focus

**Files:** `src/components/PomodoroTimer.jsx`

### Phase 0 sign-off

- [x] All 0.1–0.6 items checked
- [ ] Manual test: solo multi-tab (2 tabs, same user)
- [ ] Manual test: invite join same tab
- [ ] Manual test: invite join cross-tab
- [ ] Manual test: sync session, 2 participants, controller backgrounds tab 2 min
- [ ] No new console errors during a full 25-min solo pomodoro
- [x] `npm run build` passes

---

## Phase 1 — Extract PomodoroEngine

**Scope:** Single timer engine per browser; `PomodoroTimer.jsx` becomes presentation only.  
**Risk:** Medium (large move, behavior should be identical)  
**Depends on:** Phase 0 (recommended)

### 1.1 New module structure

- [ ] Create `src/pomodoro/types.ts` — `PomodoroRow`, `TimerDisplay`, `TimerIntent`, `Durations`
- [ ] Create `src/pomodoro/derive.ts` — `remoteRemainingSeconds`, `deriveDisplay(row, now, durations)`
- [ ] Create `src/pomodoro/applyRemoteRow.ts` — pure merge + `rowsConflict` (move from component)
- [ ] Create `src/pomodoro/commands.ts` — wrappers around current `flushToServer` logic
- [ ] Create `src/pomodoro/useTimerTick.ts` — single shared interval
- [ ] Create `src/pomodoro/PomodoroContext.tsx` — provider + `usePomodoro()` hook

### 1.2 Move logic out of PomodoroTimer.jsx

- [ ] Move timer state (`mode`, `secondsLeft`, `isRunning`, `sessions`, `pendingMode`) into context
- [ ] Move refs (`endsAtMsRef`, `latestRef`, `suppressRemoteUntilRef`, etc.) into context
- [ ] Move hydrate effects (solo + sync) into provider
- [ ] Move Realtime subscriptions (solo + sync) into provider — **one subscription total**
- [ ] Move `visibilitychange` + proactive poll into provider
- [ ] Move completion effect into provider
- [ ] Move `flushToServer`, `applyRemoteRow`, `commitToPhase`, `beginTransition` into provider/commands

### 1.3 Slim down PomodoroTimer.jsx

- [ ] Replace internal state with `usePomodoro()`
- [ ] Keep only UI: ring, buttons, modals, PiP portal, sound settings panel
- [ ] Confirm file is substantially smaller (target: < 800 lines presentation)

### 1.4 Mount provider once

- [ ] Add `<PomodoroProvider>` in `AppLayout` above routes (needs `userId`, `syncSession` from props/context)
- [ ] Floating panel and `PomodoroPage` both use `usePomodoro()` — no duplicate subscriptions
- [ ] PiP portal reads from same context instance
- [ ] Remove per-mount `channelSuffixRef` workaround (no longer needed)

**Files:** `src/App.jsx`, `src/components/PomodoroTimer.jsx`, `src/pages/PomodoroPage.jsx`, `src/pomodoro/*`

### Phase 1 sign-off

- [ ] Only one Realtime channel per user/session per browser (verify in Supabase dashboard or network)
- [ ] Floating panel ↔ `/pomodoro` page show identical time
- [ ] PiP shows identical time to main view
- [ ] All Phase 0 tests still pass
- [ ] `npm run build` passes

---

## Phase 2 — Intent-based mutations

**Scope:** Replace ad-hoc `flushToServer({ … })` patches with semantic commands.  
**Risk:** Low–medium  
**Depends on:** Phase 1

### 2.1 Define intents

- [ ] `START` — `is_running=true`, `remaining_seconds=current` → trigger sets `ends_at`
- [ ] `PAUSE` — `is_running=false`, `remaining_seconds=computed from ends_at`
- [ ] `RESET` — full duration for current mode, paused, clear `pending_mode`
- [ ] `SWITCH_MODE(mode)` — new mode, full duration, paused
- [ ] `SKIP_TRANSITION` — commit `pending_mode` → new phase
- [ ] `SET_DURATION(mode, seconds)` — update duration + reset that phase
- [ ] `BEGIN_TRANSITION(nextBreak)` — 5s countdown with `pending_mode`

### 2.2 Client command layer

- [ ] Implement `executeIntent(intent, payload)` in `src/pomodoro/commands.ts`
- [ ] Replace all direct `flushToServer` calls in provider with intents
- [ ] Always read current remaining from `deriveDisplay` / `latestRef`, never from stale closure

### 2.3 Optional RPC (solo)

- [ ] Add migration `solo_pomodoro_command(intent, payload)` if desired for atomic validation
- [ ] Or keep direct upsert for solo (simpler; sync is higher risk)

**Files:** `src/pomodoro/commands.ts`, `src/pomodoro/PomodoroContext.tsx`, optional migration

### Phase 2 sign-off

- [ ] Start → pause → resume → complete cycle: server row matches UI at every step
- [ ] Network tab shows one clean write per user action (no duplicate/conflicting patches)
- [ ] `npm run build` passes

---

## Phase 3 — Sync session coordinator

**Scope:** Single owner for session membership; timer engine consumes it.  
**Risk:** Medium  
**Depends on:** Phase 0 (0.1, 0.2); can parallelize with Phase 1

### 3.1 Extract SyncSessionProvider

- [ ] Create `src/sync/SyncSessionContext.tsx` (or `src/context/SyncSessionContext.tsx`)
- [ ] Move from `App.jsx`: `syncSession`, `syncParticipants`, `presenceMap` state
- [ ] Move rehydrate-from-localStorage effect
- [ ] Move `handleSessionJoined`, `handleLeaveSync`, `handleEndSync`, etc.
- [ ] Move presence channel + 15s participant poll
- [ ] Move `BroadcastChannel` listener (from Phase 0)
- [ ] Move `ql-sync-session-joined` listener

### 3.2 Wire timer engine to coordinator

- [ ] `PomodoroProvider` reads `syncSession` from `useSyncSession()` instead of props
- [ ] Remove `readPendingSyncSessionId()` guards from timer code — coordinator guarantees session is set
- [ ] Remove duplicate `sync_sessions` Realtime merge in `App.jsx` (coordinator owns metadata; engine owns timer fields)

### 3.3 Unify join paths

- [ ] Ensure all join paths fire both `localStorage` write AND `ql-sync-session-joined`:
  - [ ] `JoinSyncPage`
  - [ ] `PomodoroPage` (team session join)
  - [ ] `TeamPage`
  - [ ] `SyncSessionModal` (create)
- [ ] Ensure all leave/end/kick paths fire `BroadcastChannel` post

**Files:** `src/App.jsx`, `src/sync/*` or `src/context/SyncSessionContext.tsx`, join pages

### Phase 3 sign-off

- [ ] Join from every entry point updates all tabs within 1s
- [ ] Leave/end in one tab clears session in all tabs
- [ ] Kicked user drops session in all tabs
- [ ] Timer never writes to `user_pomodoro_state` while in a sync session
- [ ] `npm run build` passes

---

## Phase 4 — Sync durations & preferences to server

**Scope:** Phase lengths and auto-transition consistent across devices.  
**Risk:** Medium (migration + backward compat)  
**Depends on:** Phase 1

### 4.1 Database migration

- [ ] Create `supabase/migrations/YYYYMMDD_pomodoro_durations.sql`
- [ ] Add to `user_pomodoro_state`:
  - [ ] `durations jsonb NOT NULL DEFAULT '{"work":1500,"shortBreak":300,"longBreak":900}'`
  - [ ] `auto_transition boolean NOT NULL DEFAULT true`
- [ ] Add same columns to `sync_sessions`
- [ ] Apply migration to staging

### 4.2 Read path

- [ ] On hydrate, load `durations` and `auto_transition` from server row
- [ ] Fall back to localStorage if column null (pre-migration rows)
- [ ] Sync mode: participants use session's `durations` (controller sets)

### 4.3 Write path

- [ ] Solo: persist duration edits and auto-transition toggle to `user_pomodoro_state`
- [ ] Sync: controller persists to `sync_sessions`
- [ ] Keep localStorage as offline cache / migration bridge

### 4.4 UI

- [ ] Progress ring uses server-synced durations in sync mode
- [ ] Reset uses server-synced durations

**Files:** migration, `src/pomodoro/PomodoroContext.tsx`, `src/components/PomodoroTimer.jsx`

### Phase 4 sign-off

- [ ] Device A sets 20-min work; Device B (same user, solo) sees 20-min after refresh
- [ ] Sync session: all participants show same progress ring
- [ ] Existing users with only localStorage durations: no data loss on first load
- [ ] `scripts/smoke-pomodoro.mjs` still passes (update if needed)
- [ ] `npm run build` passes

---

## Phase 5 — Server-authoritative phase completion (sync)

**Scope:** Phase advances even if controller tab is backgrounded or closed.  
**Risk:** High (DB logic must mirror client rules exactly)  
**Depends on:** Phase 2, Phase 4 (durations on server)

### 5.1 Choose approach

Pick one (check when decided):

- [ ] **Option A:** `sync_tick_if_due(session_id)` RPC — idempotent, callable by any participant; advances if `ends_at < now()`
- [ ] **Option B:** `pg_cron` job every 10s scans active sync sessions and advances expired rows
- [ ] **Option C:** Trigger on SELECT / Realtime payload recomputation (heavier)

**Recommended:** Option A (client poll + Realtime) for v1; Option B as backup.

### 5.2 Implement server advancement logic

Mirror current client rules in SQL/PLpgSQL:

- [ ] If `pending_mode` set and countdown expired → `commitToPhase(pending_mode, autoStart=true)`
- [ ] If `mode = work` and expired → increment `sessions`, set `pending_mode` or next break per `auto_transition` and `defaultBreakForStreak`
- [ ] If `mode = break` and expired → reset streak if long break, go to `work` paused
- [ ] Use session `durations` jsonb for phase lengths
- [ ] Only advance when `is_running = true` and `ends_at < now()`
- [ ] Set new `ends_at` via existing trigger

### 5.3 Client changes

- [ ] Remove local phase advancement in sync mode (`if (isSynced && !isController) return` block becomes full observer)
- [ ] Controller may still call `sync_tick_if_due` on interval (15–30s) as backup
- [ ] All participants poll or rely on Realtime for phase changes
- [ ] Completion sound: only controller OR only on explicit phase-change event (not local zero crossing)

**Files:** new migration, `src/pomodoro/PomodoroContext.tsx`

### Phase 5 sign-off

- [ ] Controller starts 1-min test session, backgrounds tab → phase advances at expiry for all participants
- [ ] Controller closes tab (non-leader) → another participant's poll advances phase
- [ ] Auto-transition (5s) works when `auto_transition = true` on server
- [ ] Manual transition (no auto) works when `auto_transition = false`
- [ ] Long break every 4 work sessions still correct
- [ ] `npm run build` passes

---

## Phase 6 — Conflict model simplification

**Scope:** Remove timing hacks; clearer solo vs sync behavior.  
**Risk:** Low  
**Depends on:** Phases 1, 2, 5

### 6.1 Sync mode

- [ ] Remove `pendingRemoteRow` conflict UI for sync participants (read-only observers)
- [ ] Remove `suppressRemoteUntilRef` for sync (single writer: controller)
- [ ] Followers always apply remote row (last-write-wins on `updated_at`)

### 6.2 Solo mode

- [ ] Keep last-write-wins on `updated_at`
- [ ] Replace blocking conflict modal with non-blocking toast: "Timer updated on another device"
- [ ] Or keep soft conflict prompt only when user has unsaved local progress (optional)

### 6.3 Cleanup

- [ ] Remove `channelSuffixRef` (already gone after Phase 1)
- [ ] Remove `readPendingSyncSessionId()` (gone after Phase 3)
- [ ] Remove dead `control_mode` UI references if any remain (superseded by `controller_id`)
- [ ] Document final state machine in this file or `src/pomodoro/README.md`

**Files:** `src/pomodoro/applyRemoteRow.ts`, `src/components/PomodoroTimer.jsx`

### Phase 6 sign-off

- [ ] Sync: no conflict prompts between participants
- [ ] Solo multi-tab: predictable behavior (toast or silent LWW)
- [ ] Code review: no `suppressRemoteUntilRef` or timing-based echo suppression
- [ ] `npm run build` passes

---

## End-to-end test matrix

Run after each phase; full matrix required before production deploy.

| # | Scenario | Phase 0 | Phase 1 | Phase 3 | Phase 5 |
|---|----------|---------|---------|---------|---------|
| 1 | Solo: start, pause, resume, complete | [ ] | [ ] | [ ] | [ ] |
| 2 | Solo: consistent across 2 tabs | [ ] | [ ] | [ ] | [ ] |
| 3 | Solo: consistent across 2 devices | [ ] | [ ] | [ ] | [ ] |
| 4 | Refresh mid-timer preserves time | [ ] | [ ] | [ ] | [ ] |
| 5 | Background tab 10+ min → correct on focus | [ ] | [ ] | [ ] | [ ] |
| 6 | Invite join, same tab, app already open | [ ] | [ ] | [ ] | [ ] |
| 7 | Invite join, cross-tab | [ ] | [ ] | [ ] | [ ] |
| 8 | Team page join | [ ] | [ ] | [ ] | [ ] |
| 9 | Sync: 3 participants, identical time (±1s) | [ ] | [ ] | [ ] | [ ] |
| 10 | Sync: only controller hears completion | [ ] | [ ] | [ ] | [ ] |
| 11 | Sync: controller backgrounded → phase advances | — | — | — | [ ] |
| 12 | Take control → pause/resume works | [ ] | [ ] | [ ] | [ ] |
| 13 | Leave in tab A → tab B clears session | [ ] | [ ] | [ ] | [ ] |
| 14 | PiP matches main view | — | [ ] | [ ] | [ ] |
| 15 | Custom durations sync (Phase 4+) | — | — | — | [ ] |
| 16 | Realtime disabled 30s → recovers | [ ] | [ ] | [ ] | [ ] |
| 17 | Logged-out local timer still works | [ ] | [ ] | [ ] | [ ] |
| 18 | 25-min real pomodoro, no console errors | [ ] | [ ] | [ ] | [ ] |

---

## Implementation order

```
Phase 0 (bugs)
    ↓
Phase 3 (session coordinator) ── parallelizable with Phase 1
    ↓
Phase 1 (engine extract)
    ↓
Phase 2 (intents)
    ↓
Phase 4 (durations on server)
    ↓
Phase 5 (server completion)
    ↓
Phase 6 (conflict cleanup)
```

---

## Files reference

### Current (pre-refactor)

| File | Role |
|------|------|
| `src/components/PomodoroTimer.jsx` | Timer logic + UI (monolith) |
| `src/App.jsx` | Sync session shell, floating timer mount |
| `src/pages/PomodoroPage.jsx` | Embedded timer, team join |
| `src/pages/JoinSyncPage.jsx` | Invite join flow |
| `src/lib/syncSession.js` | Session CRUD RPCs |
| `supabase/migrations/20260504120000_user_pomodoro_state.sql` | Solo state + `ends_at` trigger |
| `supabase/migrations/20260519130000_sync_sessions.sql` | Sync sessions |
| `supabase/migrations/20260610120000_pomodoro_pending_mode.sql` | 5s transition |
| `supabase/migrations/20260611120000_sync_controller.sql` | `controller_id` single writer |

### Target (post-refactor)

| File | Role |
|------|------|
| `src/pomodoro/PomodoroContext.tsx` | Single timer engine |
| `src/pomodoro/derive.ts` | Display derivation from `ends_at` |
| `src/pomodoro/commands.ts` | Intent-based mutations |
| `src/pomodoro/applyRemoteRow.ts` | Remote merge logic |
| `src/sync/SyncSessionContext.tsx` | Session membership coordinator |
| `src/components/PomodoroTimer.jsx` | Presentation only |

---

## Production deploy gate

- [ ] All phases complete (or explicitly deferred with sign-off)
- [ ] Full test matrix (18 scenarios) passed on preview build (`npm run build && npm run preview`)
- [ ] Two browser profiles + incognito tested for sync flows
- [ ] Migrations applied to staging Supabase
- [ ] `scripts/smoke-pomodoro.mjs` passes
- [ ] No regressions for existing `user_pomodoro_state` rows
- [ ] Post-deploy: monitor Realtime channel count for 24h

---

## Deferred / out of scope

- [ ] Google Meet auto-pause
- [ ] Tauri/Electron menu-bar tray
- [ ] Anonymous user cleanup job
- [ ] Guest → real-account linking
- [ ] Automated E2E tests (Playwright) — recommended follow-up
