# Saved custom room layouts

**Status:** 💡 Idea / noted (not built). Requested 2026-06-21.

## Today
- Built-in presets live in `src/components/office/roomLayout/presets.js` (Call+Chat,
  Whiteboard focus, etc.).
- A user's edits flip `presetId` to `"custom"` and persist **per-user, per-room**
  in localStorage (`ql_room_layout:{roomId}`) via `useRoomLayout.js`.
- There's **no way to name/save a custom arrangement and reuse it** across rooms.

## Feature
Let a user save the current arrangement as a **named layout** that shows up in the
`LayoutBar` presets dropdown alongside the built-ins, applyable in any room, and
deletable.

## Approach (small–moderate, all client-side to start)
- **Store:** new localStorage key `ql_room_layout_presets` → array of
  `{ id, label, tree }` (per-user, not synced — matches the current model).
- **Hook (`useRoomLayout.js`):**
  - `saveCurrentAs(label)` → snapshot `state.tree`, push to the saved store, set
    `presetId` to the new id.
  - `deleteSavedPreset(id)`.
  - `applyPreset(id)` must resolve saved ids too (look up the saved tree, not just
    `presetTree(id)` from the built-in list).
- **UI (`LayoutBar.jsx`):** a "Saved" section in the dropdown listing saved layouts
  (with a small delete affordance), plus a "Save current layout…" item that prompts
  for a name. The quick-toggle buttons (just shipped) already cover ad-hoc add/remove;
  this is for *naming and reusing* a full arrangement.

## Later / open
- **Share to the room:** "present my layout to everyone" via the session
  controller — already flagged as a later phase in `useRoomLayout.js`'s comment.
  Would need a DB-backed store (room or session column) instead of localStorage.
- Whether saved layouts are global to the user or scoped per room-kind.
