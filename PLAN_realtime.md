# Plan: Upgrade Cross-Device Sync to Supabase Realtime

## Current State

| Data | Current Sync | Delay | Should Upgrade? |
|------|-------------|-------|-----------------|
| Pomodoro (solo) | Realtime | <100ms | Already done |
| Pomodoro (sync sessions) | Realtime | <100ms | Already done |
| Sync presence | Realtime + Presence | <100ms | Already done |
| **Clock-in/out** | **Polling (10s) + visibilitychange** | **Up to 10s** | **YES — high impact** |
| Entries (time logs) | Manual refresh only | Until reload | No — low frequency, read on load |
| Planner tasks | Manual refresh only | Until reload | No — low frequency, single-user |
| Settings/templates | Manual refresh only | Until reload | No — rarely changed |
| Team data | Manual refresh only | Until reload | No — admin-only, low frequency |

## What to Upgrade

### 1. Clock-In/Clock-Out → Realtime (HIGH PRIORITY)

**Why**: This is the most important sync gap. If you clock in on your phone and then open your laptop, there's up to a 10-second delay before the laptop knows you're clocked in. Worse, if you clock out on one device, the other device could still show you as clocked in and let you try to submit a duplicate entry.

**Current implementation** (`AppContext.jsx:183-216`):
- `setInterval(syncFromDB, 10_000)` polls `user_settings.active_clock` every 10s
- `visibilitychange` listener re-fetches on tab focus
- Writes clock state to `user_settings.active_clock` on clock-in/out

**Plan**:
1. Add `user_settings` table to Supabase Realtime publication (migration)
2. Subscribe to `postgres_changes` on `user_settings` filtered by `user_id`
3. When a remote change arrives, update `clockIn` state (reuse existing `clockInFromDBRef` pattern)
4. **Keep the visibilitychange listener** as a fallback for reconnection after sleep
5. **Remove the 10-second polling interval** — no longer needed

**Changes**:
- New migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.user_settings;` + set replica identity
- `src/context/AppContext.jsx`: Replace polling interval with Realtime subscription (~15 lines changed)

### 2. NOT Upgrading (and why)

**Entries / Planner Tasks**: These are loaded once on app mount. Users don't typically have two devices open adding entries simultaneously. A full Realtime subscription on entries would mean processing every INSERT/UPDATE/DELETE across what could be thousands of rows. The cost outweighs the benefit — the current "load on mount" pattern is correct.

**Settings / Templates / Projects**: Changed very rarely (once a week at most). Not worth a persistent subscription.

**Team data**: Admin-only, viewed infrequently. The TeamContext already re-fetches when navigating to the team page.

---

## Implementation

### Migration

**File**: `supabase/migrations/20260519170000_user_settings_realtime.sql`

```sql
-- Enable Realtime on user_settings for instant cross-device clock sync
ALTER TABLE public.user_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_settings;
```

### AppContext.jsx Changes

**File**: `src/context/AppContext.jsx`

**Replace** the polling interval block (lines ~183-216) with a Realtime subscription:

```jsx
// ── Real-time clock sync (cross-device) ──
useEffect(() => {
  if (!session?.user?.id) return;

  // Still sync on tab focus as a reconnection fallback
  async function syncFromDB() { /* existing function, keep as-is */ }
  function onVisible() { if (!document.hidden) syncFromDB(); }
  document.addEventListener("visibilitychange", onVisible);

  // Realtime subscription replaces the 10s polling interval
  const channel = supabase
    .channel(`clock:${session.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "user_settings",
        filter: `user_id=eq.${session.user.id}`,
      },
      (payload) => {
        const dbClock = payload.new?.active_clock ?? null;
        const localClock = clockInRef.current;
        if (dbClock?.stopped === true) {
          if (localClock !== null) {
            clockInFromDBRef.current = true;
            setClockIn(null);
            localStorage.removeItem("ql_clock_in");
          }
        } else if (dbClock !== null && JSON.stringify(dbClock) !== JSON.stringify(localClock)) {
          clockInFromDBRef.current = true;
          setClockIn(dbClock);
          localStorage.setItem("ql_clock_in", JSON.stringify(dbClock));
        }
      }
    )
    .subscribe();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    supabase.removeChannel(channel);
  };
}, [session?.user?.id]);
```

**Key**: Remove the `setInterval(syncFromDB, 10_000)` and `clearInterval(pollInterval)` lines. Keep the `visibilitychange` listener as a reconnection fallback.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/20260519170000_user_settings_realtime.sql` | New: enable Realtime on user_settings |
| `src/context/AppContext.jsx` | Replace 10s polling with Realtime subscription (~15 lines) |

## Verification

1. Open the app on two devices/browsers logged into the same account
2. Clock in on Device A → Device B should show the clock banner **instantly** (not after 10s)
3. Clock out on Device A → Device B should hide the clock banner instantly
4. Close laptop lid, reopen → clock state should re-sync on tab focus (visibilitychange fallback)
5. Verify pomodoro timer still works (no regression from adding user_settings to Realtime)
