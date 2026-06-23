# Changelog

Notable changes to Mangodoro. Pre-1.0, so grouped by date/area rather than
semantic versions. Newest first.

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
