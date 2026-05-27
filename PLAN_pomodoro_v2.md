# Plan: Pomodoro v2 — Team Discovery, Open/Leader Modes, Sounds, Invite Links, Guests, Status, Dedicated Page

## Decisions baked in
- **Guests**: Supabase anonymous auth (`signInAnonymously`).
- **Google Meet**: deferred. We add a manual "In meeting" status hook now.
- **macOS menu bar**: App Badge API + dynamic `document.title`. Native menu bar (Tauri) listed as a follow-up only.

---

## Phase 1 — Team session discovery + 1-click join

**Goal**: Team members see active team pomodoros in the app and join with one click.

### DB
- New migration `supabase/migrations/20260527120000_team_sync_visibility.sql`:
  - Add RLS SELECT policy on `sync_sessions`: team members of `team_id` can see active team sessions (in addition to existing leader/participant policies).
  - Add RLS SELECT on `sync_session_participants`: team members of the session's team can see participants of active team sessions.
  - Add to `supabase_realtime` publication: confirm both tables already there (they are per `20260519130000`); no-op if so.
  - Index: `CREATE INDEX IF NOT EXISTS idx_sync_sessions_team_active ON sync_sessions(team_id) WHERE status='active';`
  - New column `sync_sessions.visibility text` with check constraint (`'team' | 'invite_only'`), default `'team'`. When `'invite_only'`, exclude from team discovery query.

### Frontend
- `src/context/TeamContext.jsx`: add
  - `activeTeamSessions` state (array)
  - `loadActiveTeamSessions()` query: `sync_sessions` joined with leader's `user_settings.name/avatar_url` and participant count, filtered to `status='active' AND visibility='team' AND team_id=activeTeamId`.
  - Realtime channel `team-sessions:{teamId}` subscribed to INSERT/UPDATE/DELETE on `sync_sessions` filtered by `team_id`.
- `src/pages/TeamPage.jsx`: new "Active sessions" section above member list — cards showing leader avatar, name, mode (work/break), remaining time (derived from `ends_at`), participant count, **Join** button.
- `src/components/Nav.jsx`: pomodoro button gains a badge dot when any team session is active and user isn't in one.
- `src/lib/syncSession.js`: existing `joinSyncSession(code, displayName)` is reused — TeamPage card resolves `join_code` from the session row.

---

## Phase 2 — Open vs Leader-led control mode

**Goal**: Either anyone can start/stop, or the leader exclusively can — set on the session.

### DB
- Migration `supabase/migrations/20260527130000_sync_control_mode.sql`:
  - `ALTER TABLE sync_sessions ADD COLUMN control_mode text NOT NULL DEFAULT 'open' CHECK (control_mode IN ('open','leader'));`
  - Update RLS UPDATE policy on `sync_sessions`:
    - Leader can always update.
    - Active participants can update **only** the timer fields (`is_running`, `remaining_seconds`, `mode`, `sessions`) when `control_mode='open'`.
  - Approach: drop the broad leader-only UPDATE policy, replace with two:
    - `sync_sessions_update_leader` (`auth.uid() = leader_id`)
    - `sync_sessions_update_open` (`control_mode='open' AND auth.uid() IN participants WHERE left_at IS NULL`) — note Postgres RLS can't restrict columns, so enforce via a `BEFORE UPDATE` trigger that blocks non-leader writes to non-timer columns. Trigger: `tr_sync_sessions_guard_update`.
  - RPC `set_sync_control_mode(p_session_id uuid, p_mode text)` — leader-only.

### Frontend
- `src/components/PomodoroTimer.jsx`:
  - Replace `canControl = isLeader` with `canControl = isLeader || (syncSession.control_mode === 'open' && isParticipant)`.
  - Toolbar: leader sees a toggle "Anyone can control / Leader only". Non-leaders see a label.
  - Pass `control_mode` through `applyRemoteRow`.
- `src/components/SyncSessionModal.jsx` (Create tab): add radio "Anyone can control" (default) / "Leader-led".

---

## Phase 3 — Sound library overhaul

**Goal**: Wide range from gentle to aggressive/loud/long. Per-event sound (work-end vs break-end), repeat option, test button.

### Sound assets
- Keep Web Audio synthesis for the gentle set. Add real audio files for loud/aggressive presets — many short royalty-free wavs/mp3s. Put under `public/sounds/`:
  - `gentle-chime.mp3`, `soft-bell.mp3`, `digital-beep.mp3` (existing-equivalent)
  - `alarm-clock.mp3`, `bell-tower.mp3`, `air-horn.mp3`, `klaxon.mp3`, `siren.mp3` (aggressive)
  - `meditation-bowl.mp3`, `wood-block.mp3` (calm)
  - (User to source files; placeholders ok.)
- `src/lib/pomodoroSound.js` rewrite:
  - `PRESETS` array with `{id, label, kind: 'synth' | 'file', src?, durationMs, category: 'calm'|'standard'|'aggressive'}`.
  - `playCompletionSound(settings)` branches on `kind`. For `file`, use a cached `HTMLAudioElement` per preset; honor `volume`, `pitch` (via `playbackRate`).
  - New settings: `repeat` (1/2/3/until-dismissed), `repeatGapMs`, `workEndPreset`, `breakEndPreset`.
  - Add `stopCompletionSound()` for "until-dismissed".

### Settings UI
- `src/components/SettingsModal.jsx`: new "Pomodoro sounds" section
  - Grouped preset dropdowns (Calm / Standard / Aggressive)
  - Separate selectors for work-end and break-end
  - Volume slider, repeat selector, "Test" button per preset
  - Persist to `localStorage.ql_pomodoro_sound` (existing key, extended shape) — migrate old shape.

### Permissions
- For background tab playback, prompt for `Notification` permission and fire a notification alongside the sound (helps when tab not focused).

---

## Phase 4 — One-click invite link + guest join + required name

**Goal**: Share a URL → click → land in session. Optional guest mode. Block joining without a display name.

### Routing
- New route `/pomodoro/join/:code` in `src/App.jsx`.
- New page `src/pages/JoinSyncPage.jsx`:
  - Looks up session preview (a new public RPC `get_sync_session_preview(p_code)` returns minimal fields: leader name, mode, participant count, requires_account boolean) — security definer, no RLS bypass beyond preview fields.
  - If not signed in: show "Sign in", "Sign up", "Continue as guest" buttons.
  - If signed in but no display name in `user_settings.name`: inline name input (saves to `user_settings`).
  - On submit: call `joinSyncSession(code, displayName)`, then navigate to `/pomodoro`.

### Guest auth (Supabase anonymous)
- Enable anonymous sign-ins in Supabase dashboard (manual step — call out in verification).
- New helper `src/lib/auth.js`:
  - `signInAsGuest(displayName)` → `supabase.auth.signInAnonymously()` then upsert `user_settings(name=displayName, is_guest=true)`.
- Migration `supabase/migrations/20260527140000_guest_accounts.sql`:
  - `ALTER TABLE user_settings ADD COLUMN is_guest boolean DEFAULT false;`
  - Add `ON DELETE CASCADE` or scheduled cleanup job for anonymous users older than 24h with no activity (optional v2).
  - RLS: anon users cannot access teams/entries/planner data (existing policies tied to `auth.uid()` already enforce this — verify and tighten any gaps).
  - Guard `join_team_by_code` RPC: reject when caller is anonymous.

### Required display name
- Update `join_sync_session` RPC: `IF coalesce(p_display_name, '') = '' THEN RAISE EXCEPTION 'display_name_required'; END IF;`
- In `SyncSessionModal.jsx` join tab and `JoinSyncPage.jsx`: require non-empty name input.
- In `PomodoroTimer.jsx` "Create session" path: pull from `userSettings.name`; if empty, prompt inline.

### Invite link UI
- `SyncParticipantList.jsx` / session card: "Copy invite link" button → `${origin}/pomodoro/join/${join_code}`. Replace the bare code copy with this (keep code visible for manual entry).

---

## Phase 5 — Global user status integrated across app

**Goal**: A persistent user status ("Heads-down", "In meeting", "Available", custom text) that shows everywhere, editable from settings AND the pomodoro popup.

### DB
- Migration `supabase/migrations/20260527150000_user_status.sql`:
  - `ALTER TABLE user_settings ADD COLUMN status text DEFAULT '';`
  - `ALTER TABLE user_settings ADD COLUMN presence_state text DEFAULT 'active' CHECK (presence_state IN ('active','away','in_meeting','heads_down','available'));`
  - `ALTER TABLE user_settings ADD COLUMN status_updated_at timestamptz;`
  - Trigger to auto-set `status_updated_at`.
  - Already-realtime-published per `20260519170000`; no-op.
- RPC `set_user_status(p_status text, p_presence_state text)` — updates caller's row.

### Frontend
- `src/context/AppContext.jsx`:
  - Extend `normalizeSettings` to expose `status`, `presenceState`, `statusUpdatedAt`.
  - Realtime subscription on `user_settings` already exists (per `PLAN_realtime.md` Phase done); confirm it picks up status changes.
  - Add `updateStatus({status, presenceState})` action.
- `src/components/SettingsModal.jsx`: new "Status" section — preset chips (Available/Heads-down/In meeting/Away) + free-text 80-char input.
- `src/components/Nav.jsx`: small presence dot + status text next to the user avatar.
- `src/pages/TeamPage.jsx`: member rows show status + presence dot.
- `src/components/PomodoroTimer.jsx` (and new PomodoroPage): inline status editor at top.
- When user joins a sync session: auto-set sync participant status to mirror global status (already a per-session field — sync them on join via `join_sync_session` RPC update).

### Meet stub (deferred-but-hooked)
- Add a no-op `useMeetingDetection()` hook returning `{ inMeeting: false }`. Wire it so `if (inMeeting) updateStatus({presenceState:'in_meeting'})`. Real implementation lands in a separate plan.

---

## Phase 6 — Dedicated Pomodoro page + detachable pop-out + Badge API

**Goal**: Full `/pomodoro` page; user can detach into a small always-on-top-style window; macOS dock badge shows time remaining.

### Routes & pages
- New `src/pages/PomodoroPage.jsx`: full-page layout containing the existing `PomodoroTimer` plus side panels (participants, status editor, sound test, history of today's completed pomodoros).
- New `src/pages/PomodoroPopoutPage.jsx`: minimal compact layout for the detached window (~360×420). Same `PomodoroTimer` underneath with `compact` prop.
- `src/App.jsx`:
  - `<Route path="/pomodoro" element={<PomodoroPage />} />`
  - `<Route path="/pomodoro/popout" element={<PomodoroPopoutPage />} />` rendered **without** `AppLayout` (no nav chrome).
  - `<Route path="/pomodoro/join/:code" element={<JoinSyncPage />} />`
- `src/components/Nav.jsx`: add Pomodoro NavLink (lucide `Timer` icon). Keep the existing modal trigger as a quick-access button that opens a small popover preview; full management goes to `/pomodoro`.

### Detached pop-out
- `PomodoroPage.jsx` "Pop out" button → `window.open('/pomodoro/popout', 'pomodoro_popout', 'width=380,height=440,menubar=no,toolbar=no')`.
- Cross-window state sync: rely on Supabase Realtime (already cross-device). Add a `BroadcastChannel('pomodoro')` for instant in-browser sync of local-only UI state (sound prefs, last-tick).
- Setting `pomodoroDefaultView`: "modal" | "page" | "popout" — when user clicks the nav button, default to chosen view. Stored in localStorage.

### macOS Dock badge + title
- New `src/lib/badge.js`:
  - `setBadge(text)` → uses `navigator.setAppBadge(parseInt(remaining_minutes))` if available, else no-op. Note: numeric only; non-numeric falls back to a generic dot.
  - `clearBadge()` → `navigator.clearAppBadge()`.
- `PomodoroTimer.jsx` (and popout) tick effect:
  - Update `document.title = isRunning ? \`${formatTime(secondsLeft)} · ${mode}\` : 'QuestLogger'`.
  - Call `setBadge(Math.ceil(secondsLeft/60))` when running, `clearBadge()` when stopped.
- Update `vite.config.js` PWA manifest to declare `display_override: ['window-controls-overlay','standalone']` to make installed PWA feel like a desktop app on macOS (Chrome).
- Document the limitation: true macOS menu-bar (top bar) tray icon requires a native shell. Tauri wrapper as a future follow-up.

---

## Files to create

| File | Purpose |
|------|---------|
| `supabase/migrations/20260527120000_team_sync_visibility.sql` | Team RLS + visibility column |
| `supabase/migrations/20260527130000_sync_control_mode.sql` | Open vs leader mode |
| `supabase/migrations/20260527140000_guest_accounts.sql` | `is_guest` + RPC tightening |
| `supabase/migrations/20260527150000_user_status.sql` | Global user status columns + RPC |
| `src/pages/PomodoroPage.jsx` | Full pomodoro page |
| `src/pages/PomodoroPopoutPage.jsx` | Detached window layout |
| `src/pages/JoinSyncPage.jsx` | `/pomodoro/join/:code` |
| `src/lib/auth.js` | `signInAsGuest` |
| `src/lib/badge.js` | App Badge API wrapper |
| `public/sounds/*.mp3` | Audio asset files (user-sourced) |

## Files to modify

| File | Change |
|------|--------|
| `src/App.jsx` | New routes (Page, Popout, Join); popout rendered outside AppLayout |
| `src/components/Nav.jsx` | Pomodoro NavLink, presence dot near avatar, active-team-session badge |
| `src/components/PomodoroTimer.jsx` | `canControl` for open mode, control-mode toggle, status editor, badge/title side-effects, `compact` prop |
| `src/components/SyncSessionModal.jsx` | Control-mode selector, visibility selector, require display name |
| `src/components/SyncParticipantList.jsx` | "Copy invite link" replaces bare code copy |
| `src/components/SettingsModal.jsx` | Sound library UI, status section, pomodoro-default-view setting |
| `src/context/AppContext.jsx` | Expose status/presence, `updateStatus`, useMeetingDetection stub |
| `src/context/TeamContext.jsx` | `activeTeamSessions` + realtime subscription |
| `src/pages/TeamPage.jsx` | Active sessions cards, member status dots |
| `src/lib/syncSession.js` | New helpers (set control mode, set visibility, fetch team sessions) |
| `src/lib/pomodoroSound.js` | Preset registry, file+synth, repeat, per-event |
| `vite.config.js` | Manifest tweaks for desktop install feel |

---

## Implementation order

1. **Foundation migrations** (1, 2, 4-DB, 5-DB) — apply in one batch, verify RLS.
2. **Sound overhaul** (Phase 3) — self-contained, no DB risk, easy win.
3. **Open vs leader-led** (Phase 2 frontend) — small change, high value.
4. **Required name + invite link** (Phase 4 frontend, no guest yet).
5. **Team session discovery** (Phase 1 frontend).
6. **Global status integration** (Phase 5 frontend).
7. **Dedicated page + pop-out + Badge API** (Phase 6).
8. **Guest auth** (Phase 4 guest portion) — last because it has the biggest blast radius on RLS / auth assumptions.
9. **Phase 7 — Pre-deploy validation pass** (below). Gate before any `vercel deploy --prod`.

---

## Phase 7 — Pre-deploy end-to-end validation

**Goal**: Before pushing to production, walk every feature against a fresh staging build and confirm no regressions. Block deploy on any failure.

### Setup
- Apply all migrations against a non-prod Supabase project (or local `supabase start`).
- `npm run build && npm run preview` — validate against the production bundle, not the dev server (Realtime + service worker behave differently).
- Use two browser profiles (User A signed in, User B signed in) + one incognito window (guest). All three pointed at preview build.
- Have the Network panel open on User A; confirm no console errors during each scenario.

### Functional matrix (all must pass)

| # | Feature | Test |
|---|---------|------|
| 1 | Solo pomodoro | Start, pause, complete cycle. Sound plays, badge + title update, both clear on stop. |
| 2 | Sync create | A creates session, default `control_mode='open'`, `visibility='team'`. Code + invite link copy works. |
| 3 | Team discovery | B (same team) sees A's session card on `/team` within ~1s. Click Join → in session. |
| 4 | Invite-only | A flips visibility to `invite_only` → card disappears from B's `/team`. Invite link still works. |
| 5 | Open control | B (non-leader) pauses, resumes, switches mode → all reflected to A. |
| 6 | Leader-led | A flips `control_mode='leader'` → B's controls disable; A still works. |
| 7 | Leader leaves | A closes tab. Timer continues via `ends_at`. After timeout, next-oldest promoted (existing `leave_sync_session` path). |
| 8 | Sounds | Pick a file preset + repeat 3× → audible 3 times. Test button works in Settings. Notification fires when tab unfocused (permission granted). |
| 9 | Required name | Attempt join with empty name → blocked client-side AND RPC raises `display_name_required`. |
| 10 | Invite link signed-in | Open `/pomodoro/join/:code` in B's window while signed-in → lands in session. |
| 11 | Invite link signed-out | Open link in incognito → JoinSyncPage shows Sign in / Sign up / Continue as guest. |
| 12 | Guest join | Incognito → "Continue as guest" → enter name → in session. Guest user appears in participant list with `is_guest=true`. |
| 13 | Guest RLS | Guest navigates to `/team`, `/overview`, others' entries → all blocked / empty. `join_team_by_code` rejects. |
| 14 | Status global | A sets "Heads-down" in Settings → shows in Nav avatar, on `/team` member row, in active sync participant card. B sees update within ~1s (realtime). |
| 15 | Status from pomodoro | A changes status from PomodoroTimer status editor → propagates to settings + Nav + Team page. |
| 16 | Dedicated page | Navigate to `/pomodoro` → full layout, timer + status + participants + sound test all functional. |
| 17 | Pop-out | Click "Pop out" → child window opens (~380×440), timer in sync with parent. Close parent → pop-out continues. Close pop-out → parent unaffected. |
| 18 | Badge + title | Start timer in installed PWA (Chrome) → dock icon shows minutes; tab title shows `MM:SS · mode`. Stop → both clear. |
| 19 | PWA install | Install PWA fresh → manifest icons load, app opens standalone, service worker registers, `PWAUpdater` toast appears on next deploy. |
| 20 | Mobile | iOS Safari + Android Chrome: timer, sync, status, invite link all usable at 375px width. |
| 21 | Realtime fallback | Disable WebSocket on B for 30s → `visibilitychange` + polling fallback recovers state on re-focus. |
| 22 | RLS hardening | As B (not in team T), query `sync_sessions` filtered by `team_id=T` → returns 0 rows. As participant, returns the row. |

### Regression safety
- Run any existing unit/integration tests: `npm test` (if present) — note tests aren't currently in the repo per inspection; add at minimum a smoke script under `scripts/smoke-pomodoro.mjs` that hits each RPC and checks success.
- Diff DB state: `supabase db diff` against prod schema — confirm only the four new migrations.
- Verify no orphaned localStorage keys after upgrade (`ql_pomodoro_sound` migration runs cleanly when old shape present).

### Manual sign-off checklist (paste into PR description)
- [ ] All 22 scenarios above passed
- [ ] No console errors during a 25-min real pomodoro on preview
- [ ] Migrations applied cleanly to staging Supabase
- [ ] Supabase dashboard: anonymous sign-ins enabled
- [ ] Sound asset files present in `public/sounds/` and load under 200ms each
- [ ] App Badge API tested in installed PWA (not just browser tab)
- [ ] Existing solo-pomodoro users see no data loss (their `user_pomodoro_state` row untouched)

### Deployment
- Only after all checks: `git push` → Vercel preview → manually re-run scenarios 1–8 on the preview URL → promote to production.
- Post-deploy: monitor Supabase Realtime channel count and Postgres CPU for 24h (Phase 1 added a new per-team channel subscription).

---

## Verification

1. **Team discovery**: User A starts a session in team T. User B (same team) sees a card on `/team` with leader avatar and timer; clicks Join → enters session.
2. **Open mode**: Create session with `control_mode='open'`. User A starts, User A leaves tab, User B (not leader) clicks pause → succeeds. Switch to `leader` mode → User B's pause button disabled.
3. **Sounds**: Open settings → pick "Air horn" for work-end + repeat 3× → start a 5-second test pomodoro → audible, repeats, can be stopped.
4. **Invite link**: Copy invite link from session → open in incognito → land on JoinSyncPage → sign-in flow → join succeeds with required name.
5. **Guest**: Open invite link signed-out → "Continue as guest" → enter name → land in session. Verify guest cannot access `/team` or others' entries (RLS).
6. **Required name**: Try joining with empty name → blocked client + RPC raises.
7. **Status**: Set "Heads-down" in settings → appears in Nav, on TeamPage member row, on PomodoroTimer; change to "Available" → propagates instantly via realtime to a second device.
8. **Dedicated page**: Navigate to `/pomodoro` → full layout renders, timer works, status editor works.
9. **Pop-out**: Click "Pop out" → small window opens, timer continues, ticks stay in sync with original tab via BroadcastChannel/Realtime.
10. **Badge/title**: Start timer → installed PWA dock icon shows minute badge (Chrome/Edge); browser tab title shows "24:59 · work"; stop → both clear.
11. **No regressions**: Solo pomodoro still works; existing sync sessions created before migrations default to `control_mode='open'` and `visibility='team'` cleanly.

---

## Out of scope (follow-up plans)

- Google Meet OAuth + Calendar polling + auto-pause/auto-start.
- Tauri/Electron native shell for true macOS menu-bar tray icon.
- Anonymous-user cleanup job (24h sweeper).
- Persistent guest → real-account linking flow.
