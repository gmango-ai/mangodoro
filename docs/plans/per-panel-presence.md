# Per-panel presence ("who's in the whiteboard / ClickUp / tasks")

**Status:** 💡 Idea / noted (not built). Requested 2026-06-21.

## Concept
Show **who is currently viewing each panel/view** inside a room, surfaced two ways:
- **In-room badge on the panel** — e.g. "👁 X is viewing ClickUp", or
  "X, Y, Z are in the whiteboard — join now?" with a one-click join.
- **In the widgets sidebar** — under each widget, a small list/avatars of who's
  viewing it right now.

This makes the room feel collaborative even when people are spread across
different panels, and nudges people toward where the action is.

## Builds on existing infra
We already do ephemeral presence with **Supabase Realtime** (`useRoomCallPresence`
for the call, the emote/`OfficePresenceBar` channels). Same pattern here:
- Each client broadcasts **which panels it has open** in this room — it already
  knows this from the layout tree (`panelsIn(tree)` in `useRoomLayout`). A new
  presence channel like `room-panels:{roomId}` carries `{ user_id, name, panels:
  ["whiteboard","chat"] }`.
- Other clients aggregate → per-panel viewer counts + names.
- "Join now?" applies the relevant panel to the viewer's own layout
  (reuse `addPanelSide` / `togglePanel`).

## Where it renders
- `RoomLayout` tiles: a corner badge per panel (mirrors the spectator pill we
  just built for video).
- `WidgetsSidebar`: viewer avatars under each widget.

## Future panel types (this generalizes nicely)
The panel registry (`panels.jsx`) is the extension point — each new type gets
presence for free:
- **Tasks** panel (a task viewer).
- **ClickUp iframe** panel — embed ClickUp in a room so "X is viewing ClickUp"
  works. ⚠️ Embedding caveat: ClickUp must permit iframing (X-Frame-Options /
  CSP frame-ancestors) and handle auth/SSO inside the frame; verify ClickUp's
  embed/"public view" support before committing. A generic "web/iframe panel"
  type could cover ClickUp, Notion, Figma, etc. (each with its own embed rules).

## Open questions
- **Granularity:** "panel is open" vs "panel is focused/active". Open is simpler
  and probably enough for v1.
- **Privacy:** is per-panel presence always on, or toggleable?
- **Join semantics:** does "join now" swap your whole layout, or just add that
  panel beside what you have?
- **Layout is per-user localStorage today** — presence is the social layer over
  it; a future "present my layout to everyone" (noted in `useRoomLayout.js`)
  would pair well.
