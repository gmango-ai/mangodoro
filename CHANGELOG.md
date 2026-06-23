# Changelog

All notable changes to Mangodoro. Pre-1.0, so sections are grouped by the
`staging → main` release rollups (PRs) rather than semantic versions. Newest
first.

## [Unreleased] — `staging`

### Whiteboard — collaborative raster paint
- **Infinite tiled raster brush** alongside the vector pen. Flow space is carved
  into bitmap tiles materialised only where painted; strokes broadcast as
  vectors and rasterise locally (identical result, tiny wire).
- Brush / eraser, size slider, opacity, colour; a bottom **paint toolbar** and a
  Photoshop-style **brush-ring cursor** (sized by brush × zoom).
- Paint renders **over** nodes/images so you can paint on a picture or sticky.
- Tiles persist as PNGs in Storage (`paint/<board>/…`) and reload on open.
  - Requires migration `20260623120000_whiteboard_paint_tiles.sql` (RLS for
    collaborative `paint/` writes).

### Whiteboard — interactions
- **Interactive task checkboxes** — clicking a `- [ ]` / `- [x]` in node markdown
  toggles it and rewrites the source (syncs/persists).
- **Alt/Option-drag to clone** — drops a copy in place while the original keeps
  dragging.
- **Dot-voting on nodes** — a per-user vote badge; tallies show on every voted
  node; multiplayer via `data.votes`.
- **Comments on nodes** — a badge opens a thread popover anchored to the node
  (add, delete-your-own, relative times); closes on click-away / Escape;
  multiplayer via `data.comments`.
- **Laser pointer colour picker**; the laser dot now shows **only while pressing**
  (yours and peers').

### Whiteboard — fixes
- Vote/comment badge clicks fell through to the canvas (`pointer-events`
  inheritance) — fixed; badges no longer overlap the Inspector.
- Fixed a `CommentThread` crash (missing `X` icon import).

### Devices
- **Device accounts** — provision / pair / revoke flow with least-privilege RLS;
  admin panel, `/device` pairing, kiosk display; hardened RPCs turning the kiosk
  into a two-way video portal.

### Docs
- Rewrote `.TODO` around the three-program (record / rhythm / break) strategy.

## [2026-06-23] — released to `main` (PR #92)

### Whiteboard
- Multiplayer-safe undo/redo, copy/paste/cut, persisted pan/zoom, presence
  cursors.
- Storage-backed image nodes with drag-drop + paste; markdown in
  sticky/text/shape nodes.
- Freehand **vector pen**; **laser pointer** with a fading ink trail.
- Consolidated text panel with Google Fonts, per-node colour/alignment,
  bold/italic, text background + radius + padding, default text style;
  double-click canvas to add text.
- Grid + edge snapping, grow-to-fit (shape + sticky), shape border width/style,
  z-order, lock node, per-node opacity, multi-select align/distribute +
  match-size, export PNG.

### Video (LiveKit)
- Background blur + virtual backgrounds, refined background pipeline, Krisp noise
  cancellation, speaker/pin layouts.
- Host moderation (remove / mute from a People roster); mobile camera + mic
  permissions.

### Pomodoro / Office
- Edit room settings from inside a room; two-row mobile room header.
- Stable participant order + sort picker; sync-presence fix; office room name in
  the synced-session header.
- No-account local timer + signed-out landing; rebuilt PiP popout.
- Cross-device Live Activity clearing; push-to-start Live Activity + start a
  personal timer from the home widget; silent-push widget refresh.

### iOS widget
- Airy redesign; synced-timer pause fix; home-widget intent round-trips +
  periodic self-heal.

### Desktop (Electron) / nav / CI
- Draggable title-bar fixes, nav drawer over the header, full-height pages no
  longer overflow under the title bar.
- Glassmorphic bottom tab bar + More sheet; hamburger breakpoints; popover
  wrapped in MemoryRouter + error boundary.
- Electron release CI: Windows `.exe` + Linux AppImage, publish (not draft),
  Node bumps; quieter prod logging; fixed a team-timesheets refetch loop.
