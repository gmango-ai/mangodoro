import { leaf, split } from "./layoutTree";

// Named starting layouts shown in the room's layout menu. Each `tree()`
// returns a fresh tree (never share node objects between renders/rooms).
// Add a preset here; it shows up in the menu automatically.
export const PRESETS = [
  { id: "callStack", label: "Call + Chat", tree: () => split("col", leaf("video"), leaf("chat"), 0.6) },
  { id: "callSide", label: "Call beside Chat", tree: () => split("row", leaf("video"), leaf("chat"), 0.6) },
  { id: "call", label: "Call only", tree: () => leaf("video") },
  { id: "chat", label: "Chat only", tree: () => leaf("chat") },
  {
    id: "boardFocus",
    label: "Whiteboard focus",
    tree: () => split("row", leaf("whiteboard"), split("col", leaf("video"), leaf("chat"), 0.5), 0.68),
  },
  { id: "boardCall", label: "Whiteboard + Call", tree: () => split("row", leaf("whiteboard"), leaf("video"), 0.72) },
];

export const DEFAULT_PRESET = "callStack";

export function presetTree(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS.find((x) => x.id === DEFAULT_PRESET);
  return p.tree();
}
