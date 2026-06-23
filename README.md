# Mangodoro

A team productivity workspace that bundles a pomodoro timer, time tracker, retros, and a live "office" floor plan around an org + sub-team model. Built as a PWA on React + Supabase with realtime sync, RLS-secured multi-tenancy, and a per-user accent color system.

## Features

### Pomodoro
- 25/5/15 default with custom durations per cycle.
- **Sync sessions** — share a code, multi-user timers, leader control, hand-off, kick, "take control" flow.
- Picture-in-Picture popout so the timer stays on top of other windows.
- **Custom alarm sounds** — upload your own, or pick from synth presets across calm/standard/aggressive categories.
- **Team-shared sounds** — admins (or any member, configurable per-team) can upload sounds the whole org can pick.
- Macros: short/long break swap, status text + presence (active / available / heads-down / in-meeting / away), browser notifications.

### Office
- Drag-and-drop floor plan editor (powered by @dnd-kit) with resize handles.
- Multi-team room gating — rooms can be org-wide or restricted to specific sub-teams.
- Live occupant avatars, presence rings, click-through to join.
- Per-team office vibe (quiet / chatty / focus).

### Org & Teams
- Two-level hierarchy: an Org (with admins, members, invite codes) containing sub-Teams (PM, SWE, HR, …) with optional Team Leads.
- Org admins manage members, teams, rooms, retros, and team-shared sounds.
- Team Leads get scoped admin within their team (rooms, retros, archive).
- Per-member HR fields (hourly rate visible only to admins) and CSV/XLSX timesheet export.

### Retros
- Per-team weekly retros with sticky-note cards, drag-to-reorder columns.
- Inline Obsidian-style markdown editor (CodeMirror 6) with live formatting.
- Live / Closed / Archived lifecycle; admin-only delete.
- Goals attached to retros, shown on the pomodoro sidebar.
- Guest join via shareable link.

### Time Tracker
- Manual or automatic clock-in entries with unpaid break tracking.
- **Templates** — save common day shapes (start, end, breaks) and apply in one click.
- **Projects** — color-tag entries; per-project breakdown of hours and earnings.
- **Earnings** — set an hourly rate; per-entry / per-day / per-week / per-month totals.
- **Exports** — formatted XLSX, PDF invoice generation, Google Sheets sync.
- **AI** — DeepSeek-powered description rewrite + monthly narrative summaries.

### Theming & polish
- Light / dark modes; the `.dark` class lives on `<html>` so portals (PiP, modals) inherit correctly.
- **Accent picker** — 10 curated palettes (teal, cyan, blue, indigo, violet, pink, rose, amber, emerald, slate). Saves immediately; the entire UI — including dark-mode neutrals via `color-mix()` — retints when you switch.
- Per-accent split-complementary break color so pomodoro break mode reads as a different mode without clashing.
- Custom sticky-note color for retro cards.
- PWA with auto-update prompt; installable on desktop + mobile.

## Tech stack

- **Frontend**: [React](https://react.dev/) + [Vite](https://vitejs.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) (Radix primitives), [Lucide](https://lucide.dev/) icons, [react-router-dom](https://reactrouter.com/), [Motion](https://motion.dev/) for animations.
- **Backend**: [Supabase](https://supabase.com/) — Postgres + Auth (email/password + Google OAuth) + Storage (avatars, team icons, pomodoro sounds) + Realtime + RLS. Every mutation goes through either RLS-policied tables or SECURITY DEFINER RPCs.
- **Specialised libraries**: [@dnd-kit/core](https://dndkit.com/) for the office editor, [CodeMirror 6](https://codemirror.net/) for retros, [Recharts](https://recharts.org/) for the overview chart, [ExcelJS](https://github.com/exceljs/exceljs) + [jsPDF](https://github.com/parallax/jsPDF) for exports.
- **AI**: [DeepSeek API](https://platform.deepseek.com/) for description rewriting and monthly summaries.

## Desktop app

Prebuilt macOS / Windows / Linux installers are on the [Releases page](../../releases).
The macOS and Windows builds are **unsigned**, so the OS blocks them on first
launch — see **[Installing the desktop app](docs/desktop-install.md)** for the
one-time steps to get past Gatekeeper / SmartScreen.

## Getting started

### Prerequisites

- Node 20+ or Bun
- A Supabase project (free tier is plenty)
- (Optional) DeepSeek API key for AI features
- (Optional) Google OAuth client for Sheets export

### Setup

```bash
bun install        # or npm install
cp .env.example .env  # if present; otherwise create one with the keys below
bun run dev        # http://localhost:5173
```

`.env`:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
```

### Database

All schema lives in `supabase/migrations/`. Apply with:

```bash
supabase db push
```

The migrations cover every table, RLS policy, security-definer RPC, and storage bucket the app needs. Run them in order; the file names are timestamped so `supabase db push` handles ordering automatically.

### Supabase configuration

In the Supabase dashboard:

1. **Authentication → URL Configuration** — add `http://localhost:5173/**` and your deployed origin(s) to the Redirect URLs (with the `/**` wildcard so OAuth + email-confirm callbacks match).
2. **Authentication → Providers** — enable email/password and (optional) Google. For Google Sheets export, enable Google with the `https://www.googleapis.com/auth/spreadsheets` scope.
3. **Storage** — the bucket policies are created by the migrations, but verify `avatars`, `team-icons`, and `pomodoro-sounds` are public-read.

### Optional integrations

- **DeepSeek (AI)** — add the key per-user in Settings → Pomodoro. Stored in `user_settings.deepseek_key`.
- **Google Sheets export** — Settings → Notifications → Connect Google Sheets.

## Project layout

```
src/
  pages/         # Routed views (Pomodoro, Office, Time Tracker, Retros, Team, Settings, …)
  components/    # Shared UI (modals, cards, the pomodoro timer, room tiles, sync list, …)
  context/       # AppContext (user data), TeamContext (orgs/teams/rooms/sounds), SyncSessionContext, ThemeContext
  pomodoro/      # PomodoroContext + timer state machine
  lib/           # Supabase client wrappers (rooms, retros, orgTeam, syncSession, accent, sound, …)
supabase/migrations/  # Every schema change in order
```

## Scripts

```bash
bun run dev      # Vite dev server
bun run build    # Production build (PWA assets, service worker)
bun run preview  # Preview the production build locally
```

## License

Proprietary — see repository owner.
