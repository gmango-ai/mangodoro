# Plan: Reduce DB calls & save resources

Goal: cut Supabase load (Realtime events, REST/RPC round-trips, egress) and
client CPU/battery, without changing behaviour. Driven by a four-angle audit of
realtime subscriptions, queries/RPCs, recurring timers, and context/hook fetch
architecture. Line numbers marked ✓ were verified against the code; others come
from the audit and should be re-confirmed at edit time (the files move fast).

## What's already good (keep as the templates)

- `useClockedIn` — module-level **refcounted singleton** over one realtime
  channel (the model for shared subscriptions).
- `AppContext` `clock:${userId}` — **incremental patch** of `active_clock` from
  the payload, no refetch.
- `useRoomChat`, `useWhiteboardSync`, `PomodoroEngine` — incremental payload
  application / role-gated single subscription.

## Guiding principles (every fix below is one of these)

1. **Apply the payload, don't refetch.** A realtime event already carries the
   changed row — patch state from `payload.new` instead of re-querying the table.
2. **Filter subscriptions server-side.** An unfiltered `postgres_changes` is a
   firehose; add a `filter:` so the DB only sends rows we care about.
3. **One source of truth + a shared cache.** The same profile/team/goal data is
   fetched independently by N components — lift it to a provider/cache.
4. **Poll only as a fallback.** Where a realtime channel already covers a table,
   the interval poll should be a safety net (longer, suppressed while healthy),
   not a primary path.
5. **Pause work on a hidden tab.** Timers that hit the DB or re-render should
   stop on `visibilitychange: hidden`.

---

## Phase 0 — High-impact, low-risk quick wins

### 0.1 Stop the team-member refetch storm  ⭐ biggest single win
- **Where:** `src/context/TeamContext.jsx:183-190` ✓ (the `user_settings` UPDATE
  listener) → calls `loadMembers()` (`get_team_member_profiles` RPC, line 152 ✓).
- **Problem:** the subscription is **unfiltered** — *any* `user_settings` UPDATE
  (presence flips, clock ticks, status, avatar) re-runs the full team RPC. On an
  active team this fires many times per minute, and it duplicates AppContext's
  own `clock:${userId}` handler for the current user.
- **Fix (layered, cheapest first):**
  1. **Debounce** `loadMembers` on this path (trailing ~1.5s) — mirrors the
     existing `reloadOnParticipantChange` debounce already used for sessions.
  2. **Apply incrementally:** the RPC returns name/avatar/status per member;
     instead of refetching, patch the single member from `payload.new`
     (user_id, display fields) and only do a full reload when membership changes
     (handled by the `team_members` listener at 174-182, which is already
     filtered).
  3. If incremental is too fiddly given RLS-shaped payloads, at minimum
     **filter** the subscription to the columns/rows that matter.
- **Impact:** ~90% fewer `get_team_member_profiles` calls. **Effort:** S.
  **Risk:** low (debounce first, ship, then make it incremental).

### 0.2 Filter the `sync_session_participants` firehoses
- **Where:** `src/context/TeamContext.jsx:~411` (in `team-sessions:*`) and
  `src/context/SyncSessionContext.jsx:~293` — both subscribe to
  `sync_session_participants` with **no `filter:`**.
- **Problem:** every participant heartbeat **org-wide** (~20s cadence × every
  active user) delivers an event and triggers a reload/refetch. This is the
  highest-volume realtime traffic in the app.
- **Fix:** add a server-side `filter:` (e.g. `session_id=eq.<id>` for the
  session context; for the team context, scope to the active team's sessions —
  if participants can't be filtered by team directly, keep the debounce but
  consider a DB view/RPC that emits team-scoped change signals). Verify the
  column name (`session_id`) against the table before editing.
- **Impact:** large reduction in delivered events + reload churn at any real
  team size. **Effort:** S. **Risk:** low (purely narrows what we receive;
  the existing poll remains a safety net).

### 0.3 `useClockedIn` — patch rows instead of full reload
- **Where:** `src/hooks/useClockedIn.js:17,26` ✓ — `reload()` re-runs
  `listClockedIn()` (whole-table query) on **every** `work_status` event and the
  60s poll.
- **Fix:** in the `postgres_changes` handler, update `_rows` from the payload
  (upsert/remove the single changed row by `user_id`) and `emit()`; keep the
  60s `reload()` as the reconciliation fallback. Channel can stay unfiltered
  (team-scoped rows only via RLS) or gain a team filter.
- **Impact:** ~95% fewer `work_status` queries. **Effort:** S. **Risk:** low.

### 0.4 Narrow the `select('*')` over-fetches
- **`src/lib/profiles.js:9,16` ✓** — `getProfiles`/`getProfile` use `select('*')`.
  Add a `getProfilesBasic(ids)` returning `user_id, display_name, avatar_url`
  for identity-only callers (chat mentions, rosters, org chart); keep the full
  select for the profile detail card/page.
- **`src/lib/notifications.js:~55`** — `listNotifications` `select('*')` pulls
  the bulky `payload` jsonb that the inbox list doesn't read. Select explicit
  columns; fetch `payload` only when a notification is opened.
- **Impact:** egress/bandwidth + slightly faster lists. **Effort:** S. **Risk:** low.

### 0.5 Pause DB-touching timers on a hidden tab
- **Where (all run while backgrounded):** `IdlePresence.jsx:~82` (30s, writes
  presence), `HealthReminders.jsx:~59` (30s), `AppContext.jsx:~272` reminder
  check (60s), `PomodoroEngine.js:~1144/1160` DB sync (30s/60s).
- **Fix:** a small shared `useVisibilityPausedInterval(fn, ms)` (or gate each
  `tick` on `document.hidden`). Idle detection in particular shouldn't write
  while hidden — it can evaluate once on return to visible.
- **Impact:** removes steady background DB/RPC traffic from idle tabs (most
  open tabs most of the time). **Effort:** S–M. **Risk:** low–medium (keep the
  pomodoro on-resume resync so a backgrounded timer still reconciles).

---

## Phase 1 — Shared caches / single source of truth

### 1.1 Profile cache layer  ⭐ removes N+1 in lists
- **Where:** `src/components/profile/ProfileCard.jsx:~27-33` fetches
  `getProfile(userId)` + `getUserWorkSummary(userId)` **per mounted card**. A
  roster / OrgChart with 20 members = 40 calls. `RoomChatPanel.jsx:~240` also
  lazy-fetches mention profiles ad hoc.
- **Fix:** a `ProfileCacheContext` (or extend the existing `ProfileContext`)
  with a batched, deduped `getProfiles(ids)` and a TTL'd in-memory map, plus an
  optional realtime subscription to `profiles`. ProfileCard/mentions/rosters
  read from the cache; misses are coalesced into one batched query per tick.
- **Impact:** collapses per-card N+1 into 1–2 batched calls per view. **Effort:**
  M. **Risk:** low–medium (cache invalidation; start with TTL-only, no realtime).

### 1.2 Team goals: fetch once per team, filter by room client-side
- **Where:** `src/hooks/useWeekGoals.js` — effect deps include `roomId`, so the
  4 goal queries (`listTeamGoals`/`listShownGoals`/`listGoalRooms`/
  `listGoalKeyResults`) re-run on **every room navigation**, even though
  team goals are identical across rooms (only the room-scope filter changes).
- **Fix:** split into `useTeamGoals(activeTeamId)` (cached per team, ideally
  lifted into `TeamContext` so multiple goal surfaces share it) + a thin
  client-side `useMemo` filter by `roomId`. Drop `roomId` from the fetch deps.
- **Impact:** eliminates repeated goal fetches during office/room hopping and
  the duplicate fetches between `TeamGoals`/`ProfileGoals`/the hook. **Effort:**
  M. **Risk:** medium (touches goal surfacing logic — verify room-scoped
  "shown" goals still resolve).

### 1.3 One auth/visibility refresh signal
- **Where:** `AppContext` (`:~243/322`) and `TeamContext` (`:~134/136`) each
  hook `onAuthStateChange` + `visibilitychange` and independently refetch
  (entries/templates/settings/projects + teams/members) → a focus or token
  refresh fans out into 8+ queries.
- **Fix:** a single root-level auth/visibility observer that emits one
  `mangodoro:refresh` event (debounced; skip if `user_id` unchanged on
  `TOKEN_REFRESHED`); contexts listen instead of each re-subscribing. Also add a
  "last full load < 60s ago → skip" guard in `AppContext.loadData`.
- **Impact:** removes duplicate refetch bursts on every focus/token refresh.
  **Effort:** M. **Risk:** medium (auth flows are load-bearing — change
  carefully, keep a manual refresh path).

---

## Phase 2 — Structural / lower ROI (do later)

- **2.1 Consolidate TeamContext's 5 channels** (`team-members`, `team-sounds`,
  `team-rooms`, `org-teams`, `team-sessions`, all keyed on `activeTeamId`) into
  1–2 channels to cut websocket subscription count. Effort M, ROI low–med.
- **2.2 Poll-as-fallback-only:** where realtime is healthy, suppress the
  duplicate interval poll (`SyncSessionContext` 15s refetch + 20s heartbeat,
  `TeamContext` 30s, `useClockedIn` 60s) — e.g. reset a "last realtime event"
  timestamp and only poll if it's stale. Keep heartbeats (they're writes the
  server needs). Effort M, ROI med.
- **2.3 Global relative-time tick:** `ProfileCard:~36` (and other 30s/1s
  display ticks) each run their own interval; a single app-level
  "tick every minute" the cards subscribe to avoids N timers in a roster.
  Effort S–M, ROI low (CPU/battery, not DB).
- **2.4 Combined `get_profile_and_work_summary(userId)` RPC** to fold
  ProfileCard's two requests into one round-trip. Effort S, ROI low.

---

## Measurement (prove it worked)

- **Supabase dashboard:** Realtime concurrent connections + messages/min, DB
  REST/RPC request count, and egress — before vs after, per phase.
- **Dev call counter:** a thin wrapper (dev-only) around `supabase.rpc` /
  `supabase.from().select` that increments a counter keyed by RPC/table and logs
  a summary; sanity-check "open office for 5 min, switch teams, hop 3 rooms" and
  watch `get_team_member_profiles` / `listClockedIn` / goal-query counts drop.
- **Channel count:** log `supabase.getChannels().length` to confirm consolidation
  and no leaks across navigation.

## Suggested order & risk

Phase 0 first (0.1 → 0.3 are the big wins and are individually shippable, each a
small focused PR). Then 1.1/1.2 (caches), then 1.3 (auth — most care). Phase 2 is
opportunistic. Each item is independently revertible; verify with
`npm run build` + a two-account office/team pass (the audit was static — confirm
no presence/goal regressions live).

## Out of scope / deferred

- Server-side aggregation RPCs beyond 2.4 (e.g. a single "team bootstrap" RPC
  returning members+rooms+sessions) — revisit if Phase 0/1 isn't enough.
- IndexedDB/offline caching of team data (UX, not load).
- Native (Capacitor) push instead of polling for background freshness — separate
  track (see notification layer plan).
