# Universal Widgets

Make widgets a first-class, app-wide layer instead of a room-only sidebar. One
canonical registry feeds **three surfaces** at **three sizes**, and your pinned
set follows your account everywhere.

Mockup of the target direction: the "Widgets everywhere" artifact (pinned Row-2
strip + expandable chips).

## Decisions (locked)

- **Surfaces:** build *both* a pinned topbar strip **and** an app-wide widget drawer.
- **Sidebar:** promote the office-only `WidgetsSidebar` into a global slide-over drawer (don't leave widgets trapped in rooms).
- **Pins storage:** sync per-user via `user_settings` jsonb + a merge RPC (mirror `onboarding_merge`), not per-device `localStorage`.
- **Rooms:** the BSP tile layout is unchanged; it just sources widgets from the shared registry.

## Why (current state = three drifting lists)

| Surface | List | Where it shows | Persistence |
|---|---|---|---|
| Office sidebar | `widgetById` in `src/components/office/WidgetsSidebar.jsx:62` | only inside a room | `localStorage: ql_widget_order` (`src/hooks/useWidgetOrder.js`) |
| Room tiles | `VIEW_PANELS` in `src/components/office/roomLayout/viewPanels.jsx:84` | rooms only (BSP tiles) | `localStorage: ql_room_layout:{roomId}` |
| Topbar Row 2 | hardcoded in `src/components/Nav.jsx:269` | every page (collapsible) | `localStorage: mango:navRow2` |

The two widget lists have **drifted**: the sidebar has `whiteboard`(link) + `tasks`
that tiles lack; tiles have `focus` + `clock`(big) that the sidebar lacks; ids
differ (`team-status` vs `team`, `upcoming-meetings` vs `meetings`). Row 2 is a
*third*, bespoke set of one-line gadgets (`NavPomodoroClock`, `WorkClockBar`,
`WorkingNowBar`, `WorldClockNav`, `StatusChip`).

Good news: the widget **bodies already exist and already render two ways** — full
`card` (sidebar) and chrome-less `bare` (tiles, via a `bare` prop). And Row 2
already proves the one-line form works and that `--nav-h` auto-recomputes via a
ResizeObserver so growing/shrinking the header never breaks full-height pages.

## Target architecture

### Canonical registry — `src/lib/widgets/registry.js` (new)

One entry per widget:

```js
// { id, title, icon, scope, sizes, available(ctx), render: { card, bare, chip } }
{
  id: "pomodoro",
  title: "Pomodoro",
  icon: Timer,
  scope: "global",                 // "global" | "team" | "session" | "room"
  sizes: { card: true, bare: true, chip: true },
  available: (ctx) => true,        // may inspect { inRoom, session, isAdmin, deepseekKey, ... }
  render: {
    card: (p) => <PomodoroWidget {...p} />,
    bare: (p) => <DeviceTimerPanel {...p} />,   // existing bare/room body
    chip: (p) => <PomodoroChip {...p} />,        // new one-liner (Phase 2)
  },
}
```

- **`scope`** drives visibility. `global` (pomodoro, tasks, world-clock) shows anywhere; `team` (meetings, goals, team-status) needs a team (always true in-app); `session`/`room` (whiteboard-link, meeting timer, focus, big-clock) only offer themselves where a session/room exists.
- **`sizes`** are capability flags — not every widget supports every size (e.g. `focus`/`clock` are bare-only display panels; `whiteboard`-link is card-only).
- **`available(ctx)`** is the final gate each surface calls before rendering.

### Three surfaces, one catalog

1. **Pinned strip** — Row 2 renders your `pinned` ids as `chip`s. Tap → card popover. Every page.
2. **Quick drawer** — the promoted sidebar as a global slide-over of `card`s. Every page.
3. **Room tiles** — unchanged BSP layout renders `bare`. Rooms only.

## Phases

### Phase 0 — Registry unification (invisible refactor)

Merge `widgetById` + `VIEW_PANELS` into `registry.js`. Point both existing
consumers at it with **zero behavior change**:

- `WidgetsSidebar.jsx` maps its order → `registry[id].render.card`.
- `viewPanels.jsx` / `panels.jsx` build room panels from `registry` entries where `sizes.bare` → `render.bare` (keep `min`, `icon`, `title`, `headerActions`).
- Normalize ids (`team-status`≡`team`, `upcoming-meetings`≡`meetings`) with an alias map so persisted `localStorage`/room-layout blobs still resolve.
- Keep `whiteboard`(link) + `tasks` card-only; keep `focus` + `clock` bare-only.

Exit: app looks identical; there is exactly one widget list.

### Phase 1 — Synced pin/order prefs

Mirror the onboarding merge pattern (`src/context/AppContext.jsx:1371`,
`supabase/migrations/20260701150000_onboarding_state.sql`).

- **Migration** `supabase/migrations/<new-ts>_widget_prefs.sql`:
  - `alter table user_settings add column widget_prefs jsonb not null default '{}'::jsonb;`
  - `widget_prefs_merge(p jsonb)` RPC: scalars overwrite, `order`/`pinned` arrays replace-or-union, so concurrent writers never clobber. Own-row RLS already covers it.
  - Shape: `{ pinned: string[], order: string[], drawerOpen?: bool, disabled?: string[] }`.
  - ⚠️ Shared multi-branch DB: use a fresh timestamp and apply via MCP `apply_migration` (`supabase db push` is unreliable here — see memory).
- **AppContext:** load `widget_prefs` into `settings`; add `mergeWidgetPrefs(patch)` + helpers `pinWidget/unpinWidget/reorderWidgets/setDrawerOpen` (optimistic local merge + RPC), exactly like `mergeOnboarding`.
- **Seed migration (client):** one-time import of existing `ql_widget_order` → `order` if `widget_prefs` is empty.
- `useWidgetOrder` becomes a thin adapter over synced prefs (kept for the drawer's DnD API).

### Phase 2 — Chip renderers

Add a `chip` renderer per chip-capable widget. Reuse the existing bespoke Row-2
gadgets as the chip bodies so we don't rebuild them:

| Widget | chip source | shows |
|---|---|---|
| pomodoro | `NavPomodoroClock` | `24:59 · Focus` |
| time/clock | `WorkClockBar` (compact) | `6h 12m today` |
| world-clock | `WorldClockNav` | `SF 9:12 · LDN 17:12` |
| team-status | `WorkingNowBar` | `4 working` |
| meetings | new | `Standup 2:30p` |
| tasks | new | `3 open` |
| goals | new | `2 this week` |

- Shared `WidgetChip` wrapper (`src/components/widgets/WidgetChip.jsx`): pill + viewport-aware popover portal (reuse the pattern in `EmojiTextField`'s popover). Each widget supplies inner chip content + reuses its `card` for the popover.
- **Data freshness:** chips must be cheap. Reuse contexts (pomodoro, team) where possible; for polled ones (meetings, world-clock) mandate `useVisibilityPausedInterval` — the audit found `UpcomingMeetingsWidget`/`WorldClockWidget` currently poll without pausing in background tabs. Fix as part of this phase.

### Phase 3 — Pinned strip in Row 2

- Replace Row 2's hardcoded content (`Nav.jsx:269-293`) with `<PinnedWidgetStrip>` that maps synced `pinned` → `registry` chips, filtered by `available(ctx)`.
- Keep `row2Open` collapse + the `--nav-h` ResizeObserver (untouched).
- `＋ Pin widget` menu lists chip-capable widgets to pin/unpin (writes `mergeWidgetPrefs`).
- Session/room-scoped chips off-room: hide (default) — reconsider "muted, opens on join" later.
- Mobile: horizontally scrollable chip row (Row 2 already `overflow-x-auto`).

### Phase 4 — App-wide widget drawer

- Promote `WidgetsSidebar` → `src/components/widgets/WidgetDrawer.jsx`, a global right slide-over mounted in the App shell (`App.jsx`, alongside `<Nav>` / `<PersistentVideoCall>`), gated off embed/kiosk.
- Reuse `WidgetSection` chrome + dnd-kit reorder; render `registry` `card`s where `available(ctx)` passes; order/open state from synced prefs.
- Trigger: a grid button in Row 1's right cluster (+ optional shortcut).
- `OfficeShell` / `RoomView`: retire the room-only sidebar and route its toggle to the global drawer, so there's a **single** drawer instance. In-room the drawer additionally offers session/room widgets.

### Phase 5 — Settings + cleanup

- Settings → "Widgets": enable/disable widgets (`disabled[]`), reset to defaults.
- Remove the dead `localStorage` order path (keep as cache fallback only).
- Final QA matrix: every widget × {chip, bare, card} × {global page, team page, in-room}.

## Files

**New**
- `src/lib/widgets/registry.js` — canonical catalog + id aliases + `available(ctx)`.
- `src/components/widgets/WidgetChip.jsx` — pill + popover wrapper.
- `src/components/widgets/PinnedWidgetStrip.jsx` — Row-2 strip + pin menu.
- `src/components/widgets/WidgetDrawer.jsx` — global slide-over (from `WidgetsSidebar`).
- `supabase/migrations/<ts>_widget_prefs.sql` — column + `widget_prefs_merge`.

**Edit**
- `src/components/Nav.jsx` — Row 2 → strip; add drawer trigger.
- `src/context/AppContext.jsx` — load `widget_prefs`; `mergeWidgetPrefs` + helpers.
- `src/components/office/WidgetsSidebar.jsx` — consume registry; extract drawer.
- `src/components/office/roomLayout/{viewPanels,panels}.jsx`, `RoomView.jsx` — build panels from registry.
- `src/components/office/OfficeShell.jsx` — drop room-only sidebar; use global drawer.
- `src/App.jsx` — mount `WidgetDrawer`.
- `src/hooks/useWidgetOrder.js` — adapter over synced prefs.
- chip freshness fixes in `UpcomingMeetingsWidget.jsx`, `WorldClockWidget.jsx`.

## Scope × size capability matrix

| Widget | scope | chip | bare | card |
|---|---|---|---|---|
| pomodoro | global | ✓ | ✓ | ✓ |
| tasks | global (team) | ✓ | – | ✓ |
| time/clock (work) | global | ✓ | – | ✓ |
| world-clock | team | ✓ | ✓ | ✓ |
| upcoming-meetings | team | ✓ | ✓ | ✓ |
| team-status | team | ✓ | ✓(roster) | ✓ |
| goals | team/room | ✓ | ✓ | ✓ |
| whiteboard-link | session | – | – | ✓ |
| meeting timer | session | ✓ | ✓ | ✓ |
| focus (who's-on-what) | room | – | ✓ | – |
| clock (big wall) | room | – | ✓ | – |

## Risks / watch-list

- **Id drift** vs persisted blobs → alias map + reconcile (as `useWidgetOrder.reconcile` already does).
- **Migration timestamp collision** on the shared DB → fresh ts, apply via MCP.
- **Double drawer** if office sidebar isn't fully retired → single mount in App shell.
- **Chip battery cost** → `useVisibilityPausedInterval` mandatory for polled chips.
- **Mobile real estate** → strip must not fight the bottom-nav; keep it scrollable + collapsible.
- **Scope UX** → decide hide-vs-disable for session/room widgets on global surfaces (default: hide).

## Suggested PR sequence

1. **PR1** Registry unification (invisible).
2. **PR2** `widget_prefs` migration + `mergeWidgetPrefs` + seed import.
3. **PR3** Chip renderers + pinned strip in Row 2.
4. **PR4** App-wide drawer + sidebar promotion + OfficeShell rewire.
5. **PR5** Settings toggles + cleanup + QA.
