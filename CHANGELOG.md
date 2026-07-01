# Changelog

Notable changes to Mangodoro. Pre-1.0, so grouped by date/area rather than
semantic versions. Newest first.

## 2026-07-01

- Video: restore the personal "expand" pin on each tile
- Video UI: move Deafen next to the audio controls
- Video UI: legible Join button + distinct room-audio icon
- Video: kiosk speaker-focus fix, pin/layout/fullscreen sync, deafen
- Fix scoped messages and knock handling

## 2026-06-30

- Pomodoro: stop the focus→break alert playing twice in synced sessions
- Video: full disconnect diagnostics + true fullscreen
- Handle token mint failures in LiveKit cooldown
- DB: re-apply message-attachments sender upload policy as a new migration
- Video: make call preview opt-in to stop the LiveKit 429 storm
- Fix message attachment preview URL cleanup
- Messaging UI: Slack/Teams-grade redesign
- Restrict message attachment uploads to senders
- Messaging v2: create message-attachments storage bucket
- Fix channel pin unread state
- Fix messaging channel state bugs
- Messaging v2: org-scoped inbox, team channels, richer chat
- Office: add knock-to-enter for locked rooms (code + department-gated)

## 2026-06-29

- Fix clock-out modal path, pin policy save, and video badge count
- Audio: consolidate the app's Web Audio onto one shared AudioContext
- Call: don't probe mics mid-call — label-only best-mic on room-leader switch
- Call: auto-lower your raised hand once you start speaking
- Call: add raise-hand (LiveKit) — control-bar toggle, tile badge, People queue
- Call UI: move tile pin button to bottom-right so it clears the panel window controls
- Call UI: move "N watching" pill to top-center so it stops stacking on the tile pin button
- livekit-moderate: name the missing secret(s) in the config-guard 500
- Rooms: configurable pin-for-everyone policy + one-click tile pin
- LiveKit: don't write participant signal state before connect
- LiveKit: rate-limit connection attempts + cap reconnect backoff
- Call UI: redesign People into an avatar-rich slide-in sidebar
- Call UI: one cohesive menu system + visual layout picker + microinteractions
- Call UI: own name/mute pill + distinct rounded tiles
- Call UI: initials avatar for camera-off + slim device-chooser carets
- Call UI: modern restyle of LiveKit defaults (first pass)
- Lobby settings: portal the popover so it can't be clipped by the panel
- Lobby: settings popover no longer spills off the panel
- Video Phase 2: floating self-view + mirror toggle
- Video Phase 2: audience overflow for big calls
- Web view: more platform embeds + blocked-embed fallback card
- Web view: embed Google Docs/Sheets/Slides via the /preview endpoint
- Drop dev COEP headers; plain (cookie-bearing) iframes for web views
- Web view: fix 'refused to connect' — credentialless iframes (COEP)
- Web view: YouTube play/pause/seek sync via the IFrame API
- Rooms: shared website view tiles (watch-together) — URL sync
- Video Phase 2: tile chrome — speaking ring + connection-quality dot
- Room: activity badges on closed panel toggles (call / whiteboard / chat)
- Room: 'New whiteboard' uses the full create dialog (templates + name)
- Whiteboard: anyone in the room can attach/swap it (not just the leader)
- Lobby: shared settings gear on both pre-join surfaces
- Lobby settings parity: speaker + noise + push-to-talk pre-join
- Call dock: speaker-output picker + push-to-talk
- Call lobby: unify pre-join, flip spectate to office-walk-in (Lobby slice 1)
- Video call layout: fluid adaptive stage + speaker decay (Phase 1)
- WIP snapshot: goals week-binding + whiteboard scope
- Room privacy, gating, chat moderation & kiosk fixes
- Fixes: AudioContext churn, PWA stuck-version, emote fountain perf, DM 42702
- World clock widget: org-curated operating locations + local times
- Whiteboard: text autosize, realtime text, region capture, room PNG download, image reactions
- Messaging: client — /messages page, conversation list, threads, new DM/group
- Messaging: schema + RLS + creation RPCs (Phase 1, foundation)
- Pomodoro: accumulate per-block notes into the day-log, surfaced at clock-out
- Clock: save/edit your time at clock-out via a modal (no trip to /log)
- Clock: fix cross-device clock-out auto-restart on reload
- Hallway: show people from presence detection, not just clocked-in
- Clock: disable the fixed bottom ClockBanner (top-bar WorkClockBar owns it now)
- Notifications: clear / dismiss from the inbox

## 2026-06-26

- Fix cluster merge leaving followers on abandoned id
- Rework late cluster-join + kiosk sleep loading gate
- Fix tap-to-wake blocked while sleep schedule is loading
- Fix schedule loading gate and late cluster join migration
- Kiosk offline: scheduled active hours + manual sleep/wake
- Video: 'I'm in this room' pre-join — join muted before entry (no squeal)
- Revert COOP/COEP headers in prod — they broke joining the call
- Video green room: pin Join button so it can't be clipped

## 2026-06-25

- Fix pinned room loading race and stale fetch in OrgDevicesPanel
- Fix device room select when pinned room is archived
- Device: Phase C UI — movable devices (kiosk switcher + admin controls)
- Device: Phase C migration — movable devices (room switching)
- Device: Phase B3 — view-only whiteboard on the kiosk
- Device: Phase B2 — modular room layout on the kiosk (arrangeable panels)
- Fix device RLS: active session whiteboard and chat author profiles
- Docs: plan to reduce DB calls / Supabase load
- Video: surface the LiveKit disconnect reason (diagnose silent green-room bounce)
- Device: Phase B1 — read-only RLS so a kiosk can view room chat + whiteboard
- Device: Phase A — mic / speaker / camera pickers on the kiosk
- Fix What's new toast for same-day changelog merges and PWA reloads
- What's new: changelog toast/modal + auto-changelog on push to main

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
