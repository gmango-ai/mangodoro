# Changelog

Notable changes to Mangodoro. Pre-1.0, so grouped by date/area rather than
semantic versions. Newest first. Each release lists **New & improved** (features
and changes to features) and **Fixes**.

## 2026-07-04

### New & improved

- UI(Electron): distinguish Pomodoro tray phases

### Fixes

- Allow tray popover to open without main timer handler
- Stale timer handler readiness and popover opening bugs
- (Pomodoro): remove break transition
- (Electron): wait for Pomodoro timer command readiness
- Command acknowledgement race condition in PomodoroEngine
- (Electron): repair menubar Pomodoro popover controls
- (Electron): allow video providers through CSP

## 2026-07-03

### Fixes

- (Video): stabilize call media and grid layout

## 2026-07-02

### New & improved

- **docs** — restructure changelog into New & improved / Fixes sections

### Fixes

- World clock nav pill showed city instead of pinned org label until opened

## 2026-07-01

- Persist pending welcome state after onboarding
- Fix onboarding and message tour regressions
- Fix chat author settings fallback
- Fix: non-admin members saw teammates as "Member" in chat + presence roster
- Fix create-room tour entry route
- Onboarding P5: collaboration tours + new-feature announcements
- Onboarding P4: Help / Learn center
- Onboarding P3: core tours + non-blocking auto-offer
- Onboarding P2: welcome flow + getting-started checklist
- Onboarding P1: tutorial foundation (driver.js engine + persistence)
- Video: extend auto pin + speaker dual view to Presenter mode
- Fix self spotlight ignore fallback
- Video: spotlight holds last speaker, auto pin+spotlight, ignore-self, grid default
- Fix pomodoro and message deep-link states
- Org page: People filter deep links force the People page
- Fix pomodoro FAB pending dismiss
- Pomodoro: floating popover closes on outside-click / Escape / tab re-click
- Org page: real multi-page layout grouped by what you edit together
- Nav: pomodoro is a slim clock pull-tab (no sliding FAB) + edge padding
- Fix team side nav anchors and scroll spy
- Nav: pomodoro FAB fully off-screen with a show/hide edge tab
- Green room: make 'I'm in this room' its own button (out of the mic menu)
- Green room: call-style mic/camera device menus; fold in "join room audio"
- Nav: make the pomodoro FAB edge-peek so it stops covering UI
- Org page: in-page side nav + image-forward team cards
- Fix single-room rejoin enforcement
- Sync: enforce a single active room per user across all instances
- Fix org chart cyclic reporting roots
- Org chart: card / list / reporting views + leadership + manager field
- Nav: pomodoro FAB + world-clock globe dropdown
- Video: merge Watch/Join into the green room; kiosk speaker-highlight toggle
- Video: stop camera turning off when call settings change
- Fix deafen mute and message deep links
- Video: restore the personal "expand" pin on each tile
- Video UI: move Deafen next to the audio controls
- Video UI: legible Join button + distinct room-audio icon
- Video: kiosk speaker-focus fix, pin/layout/fullscreen sync, deafen
- Fix scoped messages and knock handling

## 2026-06-30

### New & improved

- **Messaging v2** — an org-scoped inbox with team channels alongside direct and group DMs, plus image/file attachments. Slack/Teams-grade redesign of the whole surface.
- **Rooms** — knock-to-enter for locked rooms: share a code, or gate access by department.
- **Video** — full call-disconnect diagnostics, and true fullscreen that takes over the whole screen (not just the window).

### Fixes

- Messaging: attachment uploads are now restricted to the sender; channel pin unread state and other channel-state bugs fixed; attachment preview URLs cleaned up.
- Video: the call preview is opt-in, ending a LiveKit request (429) storm; token-mint failures are handled during the reconnect cooldown.
- Pomodoro: the focus→break alert no longer plays twice in synced sessions.

## 2026-06-29

### New & improved

- **Messaging** — first release: schema + a `/messages` page with a conversation list, threads, and new DM/group creation.
- **Calls: raise-hand** — a control-bar toggle, a tile badge, and a People queue; your hand auto-lowers once you start talking.
- **Call UI overhaul** — one cohesive menu system, a visual layout picker, an avatar-rich People sidebar, your own name/mute pill, distinct rounded tiles, camera-off initials avatars, and smoother microinteractions.
- **Video (Phase 2)** — floating, mirrorable self-view; audience overflow for big calls; tile chrome with a speaking ring and connection-quality dot; a fluid adaptive stage with active-speaker decay.
- **Pre-join lobby** — a shared settings gear on both surfaces, with speaker output, noise cancellation, and push-to-talk available before you join; unified pre-join that turns spectating into an office walk-in.
- **Rooms: watch-together** — shared website-view tiles with URL sync; embed Google Docs/Sheets/Slides and more platforms (with a fallback card when a site blocks embedding); YouTube play/pause/seek stays in sync.
- **Rooms & whiteboard** — pin-for-everyone policy with one-click tile pinning; anyone in the room can attach/swap the whiteboard; "New whiteboard" uses the full create dialog (templates + name); activity badges on collapsed panel toggles (call / whiteboard / chat); a world-clock widget of org-curated locations and local times.
- **Clock & office** — save or edit your time at clock-out from a modal (no trip to `/log`); per-block pomodoro notes accumulate into the day log, surfaced at clock-out; the hallway shows people from presence detection, not just who's clocked in; the top-bar clock replaces the old fixed bottom banner.
- **Notifications** — clear/dismiss items from the inbox.
- **Audio** — the app's Web Audio is consolidated onto one shared AudioContext.

### Fixes

- Clock-out modal path, pin-policy save, video badge count, and cross-device clock-out auto-restart on reload.
- Calls: don't probe mics mid-call (label-only best-mic on room-leader switch); don't write participant signal state before connect; connection attempts are rate-limited with a capped reconnect backoff.
- `livekit-moderate` now names the missing secret(s) in its config-guard 500.
- Assorted: AudioContext churn, PWA stuck-version, emote-fountain performance, DM 42702, and sync-presence rejecting valid states.

## 2026-06-26

### New & improved

- **Kiosk** — scheduled active hours plus manual sleep/wake, so a display can rest offline and wake on tap.
- **Video** — an "I'm in this room" pre-join that joins you muted before entry, so you don't squeal into the room.

### Fixes

- Cluster handoff: fixed followers being stranded on an abandoned id; reworked late cluster-join and the kiosk sleep loading gate so tap-to-wake isn't blocked while the schedule loads.
- Reverted the prod COOP/COEP headers that broke joining a call.
- Green room: pinned the Join button so it can't be clipped.

## 2026-06-25

### New & improved

- **Device kiosks** — movable devices (Phase C): a kiosk room switcher + admin controls; a modular, arrangeable room layout with a view-only whiteboard (Phase B); mic/speaker/camera pickers (Phase A); read-only access so a kiosk can view its room's chat + whiteboard.
- **What's new** — an in-app changelog toast + modal, with the changelog auto-generated on push to main.
- **Video** — surfaces the LiveKit disconnect reason to diagnose silent green-room bounces.

### Fixes

- Pinned-room loading race and a stale fetch in the org devices panel; device room select when the pinned room is archived; device RLS for the active-session whiteboard + chat author profiles.
- The "What's new" toast now fires correctly for same-day changelog merges and PWA reloads.

## 2026-06-21 → 2026-06-23 (last 48 hours)

A large burst: a near-complete collaborative whiteboard, a LiveKit video
overhaul + room-audio model, device/kiosk accounts, an "Out to lunch" status,
and pomodoro/office/iOS-widget polish.

### Whiteboard — collaborative canvas

**Foundations & collaboration**
- Multiplayer-safe undo/redo + copy/paste/cut.
- Persist pan/zoom per board.
- Easier node resizing + text selection inside nodes (nodrag/nowheel opt-outs).

**Content**
- Storage-backed image nodes; drag-drop a file onto the canvas + paste from clipboard.
- Markdown in sticky / text / shape nodes.
- Double-click empty canvas to drop a text node.
- Interactive task-list checkboxes (ticking one rewrites the markdown source).

**Text & styling**
- Per-node text colour + alignment; bold / italic buttons; text background +
  radius + padding; the text editor hugs its content while editing.
- Google Fonts + a consolidated text panel; a default text style for new text nodes.
- Shape border width + style; z-order (bring to front / send to back); lock node;
  per-node opacity; custom-colour well in the swatch pickers.
- Grid + edge snapping on resize, grow-to-fit, text wrap; sticky notes grow to fit text.

**Tools**
- Freehand vector **pen**.
- **Laser pointer** with a fading ink trail + colour picker (⌘/Ctrl-drag pans;
  the dot shows only while pressing).
- Collaborative **raster paint** layer — infinite tiled brush, strokes broadcast
  as vectors and rasterise locally, tiles persisted to Storage; bottom paint
  toolbar, Photoshop-style brush-ring cursor, paints over nodes/images.
- Multi-select align / distribute / match width-height; export board as PNG.

**Per-node collaboration**
- **Dot-voting** on nodes (per-user tallies, multiplayer).
- **Comments** on nodes (thread popover, add / delete-your-own, click-away close).
- Alt/Option-drag to clone a node.

**Fixes**
- Editing no longer balloons an auto-width text node; clipped swatch grids fixed;
  vote/comment badges no longer overlap the Inspector and their clicks register
  (pointer-events); CommentThread crash (missing import) fixed.

### Video calls (LiveKit)
- Background blur + strengths, virtual-background images, a self-managed refined
  background pipeline (crisper edges), Krisp noise cancellation, speaker/pin layouts.
- Host moderation — remove / mute from a People roster.
- **Standardised on LiveKit** (retired the Jitsi↔LiveKit A/B split).
- Room-audio model: in-room audio clustering ("companion mode") to kill same-room
  echo; split room mic-source vs audio-sink + self-serve mic take-over; clearer
  in-room mute UX; experimental opt-in proximity auto mic-switching.
- In-room badge on participant tiles; device room-leader beacon fix + tighter
  follower audio + kiosk controls.
- Mobile: declared camera + mic permissions so calls can capture devices.

### Status & presence
- New **"Out to lunch"** presence state (orange) across the status picker, room
  roster, sync-participant list, and shared presence maps.
- **Lunch-break scheduler** — Settings → Notifications: Off / Ask me / Automatic
  with a lunch time + duration. While the app is open it flips your status to
  *Out to lunch* (auto) or prompts you (ask) and flips back after the duration;
  fires a browser notification when permitted; mirrors into an active sync session.
- Fixed sync presence rejecting `heads_down` / `available` (Invalid presence_state).

### Pomodoro & Office
- Edit room settings from inside a room; two-row mobile room header (container queries).
- Stable participant order + a sort picker; office room name in the synced-session header.
- No-account local timer + signed-out landing; rebuilt the PiP popout on the
  shared timer components.

### Device accounts
- Backend: provision / pair / revoke flow with least-privilege RLS.
- UI: admin panel, `/device` pairing, kiosk display.
- Hardened RPCs; the kiosk became a two-way video portal.

### iOS widget
- Airy redesign + fixed the synced-timer widget pause.
- Await home-widget intent round-trips + periodic self-heal.

### Docs / CI / chores
- Rewrote the roadmap (`.TODO`) around the three-program strategy; added this CHANGELOG.
- Renamed the Electron release tag trigger (`electron-v*` → `Mangodoro-v*`);
  docs on opening the unsigned desktop app.

### Migrations added (apply on deploy)
- `whiteboard-images` bucket + RLS; `whiteboard_paint_tiles` RLS (collaborative paint writes).
- `lunch_break_status` (widen presence_state CHECKs + setter RPCs to `out_to_lunch`).
- `lunch_break_prefs` (`lunch_time` / `lunch_mode` / `lunch_duration_min` on user_settings).
- Org device-account tables + hardening; sync-presence full state set.
