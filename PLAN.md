# Feature Plan: Teams + Synced Pomodoro for QuestLogger

## Project Context

- **Stack**: Vite + React 18 (plain JSX), React Router v7, Tailwind CSS v4, shadcn/ui
- **Database**: Supabase (PostgreSQL 17) with Realtime, RLS policies
- **Auth**: Supabase Auth (email/password)
- **State**: React Context (`AppContext.jsx` ~1200 lines) + localStorage
- **Root**: `/Users/jek/Documents/Projects/Personal/SimpleWorkTracker/`

---

## Feature A: Teams & Timesheet Management

### A1. Database Migration

**File**: `supabase/migrations/20260519120000_teams.sql`

**New tables**:

| Table | Purpose |
|-------|---------|
| `teams` | id, name, invite_code (12-char hex, unique), created_by, timestamps |
| `team_members` | team_id, user_id, role (`admin`/`member`), joined_at, unique(team_id, user_id) |

**RLS policies**:
- `teams` SELECT: members of the team can read it
- `teams` INSERT: any authenticated user (must be `created_by`)
- `teams` UPDATE/DELETE: admin members only
- `team_members` SELECT: members can see co-members
- `team_members` INSERT: user_id = auth.uid() (self-join only)
- `team_members` UPDATE: admin can change roles
- `team_members` DELETE: self-leave OR admin-remove

**New RLS on existing tables** (additive, OR-combined with existing personal policies):
- `entries` SELECT: team admins can read their team members' entries
- `user_settings` SELECT: team admins can read member names
- `projects` SELECT: team admins can read member project names

**RPC function**: `join_team_by_code(code text)` — `security definer`, looks up team by invite code, inserts membership, returns team_id. Handles already-a-member case gracefully.

### A2. New Context

**File**: `src/context/TeamContext.jsx` (~300 lines)

Separate from AppContext to avoid bloating it further. Provides:
- `teams` — user's team list
- `activeTeamId` — currently selected team (persisted to localStorage)
- `teamMembers` — members of active team
- CRUD: `createTeam`, `joinTeam`, `leaveTeam`
- Admin: `removeMember`, `changeMemberRole`, `regenerateInviteCode`
- Timesheets: `fetchMemberEntries(teamId, month)`, `exportTeamXLSX`, `exportTeamCSV`

### A3. New Routes & Pages

| Route | File | Description |
|-------|------|-------------|
| `/team` | `src/pages/TeamPage.jsx` | Create/join teams, manage members, settings |
| `/team/timesheets` | `src/pages/TeamTimesheetsPage.jsx` | Admin: view + export member timesheets by month |

### A4. Component Changes

| File | Change |
|------|--------|
| `src/App.jsx` | Wrap `AppLayout` with `<TeamProvider>`, add 2 new `<Route>` entries |
| `src/components/Nav.jsx` | Add "Team" NavLink (lucide `Users` icon) |

### A5. New Components

| Component | Purpose |
|-----------|---------|
| `TeamInviteCard.jsx` | Shows invite code, copy button, share link |
| `TeamMemberRow.jsx` | Member row with avatar, role badge, admin actions |
| `TeamTimesheetTable.jsx` | Reusable table: entries grouped by week/day for one member |

### A6. Timesheet Export

Adapts existing `buildCSVRows` / `buildXLSX` patterns from AppContext:
- **CSV**: Single file with member-name column added
- **XLSX**: Multi-sheet workbook (one sheet per member + summary sheet), using ExcelJS already in deps

---

## Feature B: Synchronized Pomodoro Sessions

### B1. Database Migration

**File**: `supabase/migrations/20260519130000_sync_sessions.sql`

**New tables**:

| Table | Purpose |
|-------|---------|
| `sync_sessions` | id, join_code (6-char uppercase), leader_id, team_id (nullable FK), mode, sessions, is_running, remaining_seconds, ends_at, status (`active`/`ended`), max_participants, timestamps |
| `sync_session_participants` | session_id, user_id, display_name, joined_at, left_at, unique(session_id, user_id) |

**Key mechanisms**:
- `ends_at` trigger — mirrors existing `user_pomodoro_state_set_ends_at()` pattern exactly
- Both tables added to `supabase_realtime` publication with `replica identity full`
- `join_sync_session(code, display_name)` RPC — atomic lookup + participant upsert

**RLS policies**:
- `sync_sessions` SELECT: leader or active participants
- `sync_sessions` INSERT: authenticated, must be leader_id
- `sync_sessions` UPDATE: leader only (timer controls + ending)
- `sync_session_participants` SELECT: co-participants in same session
- `sync_session_participants` INSERT: self-join if session is active and not full
- `sync_session_participants` UPDATE: self only (for setting `left_at`)

### B2. Realtime Architecture

Each session uses one Supabase Realtime channel: `sync-session:{session_id}` with three layers:

| Layer | Purpose | Frequency |
|-------|---------|-----------|
| **Postgres Changes** on `sync_sessions` | Timer state (authoritative) | On leader actions |
| **Presence** | Online/offline participant indicators | Automatic heartbeat ~30s |
| **Broadcast** | Sound trigger events | At timer completion |

**Timer sync** uses the proven existing pattern: leader writes `is_running + remaining_seconds` → DB trigger computes `ends_at` → all clients derive `secondsLeft = ceil((ends_at - Date.now()) / 1000)`. No clock drift.

### B3. Modify PomodoroTimer.jsx

The existing component gains a `syncSession` prop (null = solo mode, object = sync mode):

- **Realtime subscription**: branches to `sync_sessions` table instead of `user_pomodoro_state`
- **flushToServer**: writes to `sync_sessions` instead of `user_pomodoro_state`
- **Controls**: disabled for non-leader participants (start/pause/reset/mode switch)
- **New UI sections**: participant avatars strip, join code badge, leave/end buttons
- **Reuses**: `suppressRemoteUntilRef` pattern, `playCompletionSound`, existing tick logic

### B4. New Components

| Component | Purpose |
|-----------|---------|
| `SyncSessionModal.jsx` | Create/join sync session (tabs: Create, Join) |
| `SyncParticipantList.jsx` | Horizontal avatar strip with online/offline dots |

### B5. New Utility File

**File**: `src/lib/syncSession.js`

Functions: `createSyncSession`, `joinSyncSession`, `leaveSyncSession`, `endSyncSession`

### B6. State Management

Sync session state lives in `App.jsx` (not AppContext):
```
const [syncSession, setSyncSession] = useState(null);
const [syncParticipants, setSyncParticipants] = useState([]);
```
Persisted to `localStorage` key `ql_sync_session` for reload recovery.

### B7. Edge Cases

- **Leader disconnects**: Timer continues (driven by `ends_at`). Participants see leader offline via Presence. At 00:00 with no mode transition after 10s, show "Waiting for leader..." message
- **Participant offline**: Presence dot goes gray. On reconnect, re-subscribes and re-syncs from `ends_at`
- **Stale sessions**: Client-side cleanup on app load — end sessions with `updated_at > 4 hours ago`
- **Join race conditions**: `join_sync_session` RPC is atomic (single transaction)

---

## Implementation Order

### Phase 1: Teams Database
1. Create `supabase/migrations/20260519120000_teams.sql`
2. Apply migration, verify RLS policies

### Phase 2: Teams Frontend
3. Create `src/context/TeamContext.jsx`
4. Create `src/pages/TeamPage.jsx`
5. Create `src/pages/TeamTimesheetsPage.jsx`
6. Create supporting components (`TeamInviteCard`, `TeamMemberRow`, `TeamTimesheetTable`)
7. Update `src/App.jsx` (TeamProvider + routes)
8. Update `src/components/Nav.jsx` (Team link)

### Phase 3: Sync Pomodoro Database
9. Create `supabase/migrations/20260519130000_sync_sessions.sql`
10. Apply migration, verify RLS and Realtime

### Phase 4: Sync Pomodoro Frontend
11. Create `src/lib/syncSession.js`
12. Create `SyncSessionModal.jsx` and `SyncParticipantList.jsx`
13. Modify `src/components/PomodoroTimer.jsx` (dual-mode: solo + sync)
14. Update `src/App.jsx` (syncSession state, pass props to PomodoroTimer)

### Phase 5: Integration & Polish
15. Wire `team_id` FK on `sync_sessions` to `teams` table
16. Add team-restricted sync sessions (optional team selector on create)
17. Deep-link support (`/team?join=CODE`)
18. Empty states, loading skeletons, mobile responsiveness
19. Edge case handling (last admin, stale sessions, leader disconnect)

---

## Files to Create

| File | Lines (est.) |
|------|-------------|
| `supabase/migrations/20260519120000_teams.sql` | ~120 |
| `supabase/migrations/20260519130000_sync_sessions.sql` | ~130 |
| `src/context/TeamContext.jsx` | ~300 |
| `src/pages/TeamPage.jsx` | ~400 |
| `src/pages/TeamTimesheetsPage.jsx` | ~350 |
| `src/components/TeamInviteCard.jsx` | ~60 |
| `src/components/TeamMemberRow.jsx` | ~80 |
| `src/components/TeamTimesheetTable.jsx` | ~150 |
| `src/components/SyncSessionModal.jsx` | ~200 |
| `src/components/SyncParticipantList.jsx` | ~80 |
| `src/lib/syncSession.js` | ~80 |

## Files to Modify

| File | Change |
|------|--------|
| `src/App.jsx` | Add TeamProvider, 2 routes, syncSession state |
| `src/components/Nav.jsx` | Add "Team" NavLink |
| `src/components/PomodoroTimer.jsx` | Add syncSession prop, branch realtime/flush, sync UI |

---

## Verification

1. **Teams**: Create a team → copy invite code → sign in as second user → join with code → verify admin sees both members → admin navigates to timesheets → sees member entries → downloads XLSX
2. **Sync Pomodoro**: User A creates sync session → User B joins with code → User A starts timer → both see same countdown → timer hits 0 → both hear sound → mode transitions to break for both
3. **RLS**: Verify non-admin cannot see other members' entries; non-participant cannot see sync session state
4. **Edge cases**: Leader closes tab → participant sees "waiting" message; participant leaves → removed from list; last admin leaves → team behavior is correct
