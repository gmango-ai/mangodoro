import { useCallback, useEffect, useRef, useState } from "react";
import { presetTree, DEFAULT_PRESET } from "./presets";
import { leaf, split, setRatioAt, sanitize, movePanelInTree, addPanelToTree, addPanelAtTree, removeAt, findPath, panelsIn, placementOf, restorePlacement } from "./layoutTree";

// Where a quick-added panel prefers to enter, given what's already shown.
// Whiteboard is the big canvas (left, larger share); chat hugs the right;
// video takes whichever main side is free. `frac` = the NEW panel's share.
function defaultEntry(panelId, current = []) {
  const hasBoard = current.includes("whiteboard");
  if (panelId === "whiteboard") return { side: "left", frac: 0.58 };
  if (panelId === "chat") return { side: "right", frac: 0.34 };
  if (panelId === "video") return { side: hasBoard ? "right" : "left", frac: 0.42 };
  return { side: "right", frac: 0.4 };
}

// Split the whole current layout, putting the new panel on `side` with `frac`
// of that axis.
function placeBySide(tree, panelId, side, frac) {
  if (!tree) return leaf(panelId);
  const nl = leaf(panelId);
  switch (side) {
    case "left": return split("row", nl, tree, frac);
    case "right": return split("row", tree, nl, 1 - frac);
    case "top": return split("col", nl, tree, frac);
    case "bottom": return split("col", tree, nl, 1 - frac);
    default: return addPanelToTree(tree, panelId);
  }
}

// Per-user, per-room layout. Mirrors how the old view-mode preference was
// stored (localStorage, not synced) — a "present my layout to everyone"
// option via the session controller is a later phase.
const keyFor = (roomId) => `ql_room_layout:${roomId}`;

function load(roomId, available) {
  try {
    const raw = roomId ? localStorage.getItem(keyFor(roomId)) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      const tree = sanitize(parsed.tree, available);
      // `placements` remembers where each panel sat last so a hide → show
      // returns it to that spot.
      if (tree) return { tree, presetId: parsed.presetId || "custom", placements: parsed.placements || {} };
    }
  } catch { /* */ }
  return { tree: presetTree(DEFAULT_PRESET), presetId: DEFAULT_PRESET, placements: {} };
}

export function useRoomLayout(roomId, available) {
  // `available` changes identity every render; read the latest via a ref so
  // it never retriggers the room-change reload.
  const availRef = useRef(available);
  availRef.current = available;

  const [state, setState] = useState(() => load(roomId, available));

  // Reload when switching rooms.
  useEffect(() => {
    setState(load(roomId, availRef.current));
  }, [roomId]);

  // Persist.
  useEffect(() => {
    try {
      if (roomId) localStorage.setItem(keyFor(roomId), JSON.stringify(state));
    } catch { /* */ }
  }, [roomId, state]);

  // Remember a panel's current spot before it leaves the tree, so toggling
  // it back on can restore that position.
  const remember = (s, panel) => {
    const placement = placementOf(s.tree, panel);
    return placement ? { ...s.placements, [panel]: placement } : s.placements;
  };

  const applyPreset = useCallback((id) => setState((s) => ({ ...s, tree: presetTree(id), presetId: id })), []);
  const reset = useCallback(() => setState((s) => ({ ...s, tree: presetTree(DEFAULT_PRESET), presetId: DEFAULT_PRESET })), []);
  const setRatio = useCallback((path, ratio) => {
    setState((s) => ({ ...s, tree: setRatioAt(s.tree, path, ratio), presetId: "custom" }));
  }, []);
  const movePanel = useCallback((dragged, target, zone) => {
    setState((s) => ({ ...s, tree: movePanelInTree(s.tree, dragged, target, zone), presetId: "custom" }));
  }, []);
  const addPanel = useCallback((panel) => {
    setState((s) => ({ ...s, tree: addPanelToTree(s.tree, panel), presetId: "custom" }));
  }, []);
  const addPanelAt = useCallback((panel, target, side) => {
    setState((s) => ({ ...s, tree: addPanelAtTree(s.tree, panel, target, side), presetId: "custom" }));
  }, []);
  const closePanel = useCallback((panel) => {
    setState((s) => {
      if (panelsIn(s.tree).length <= 1) return s; // never close the last tile
      const path = findPath(s.tree, panel);
      if (!path) return s;
      return { ...s, tree: removeAt(s.tree, path), presetId: "custom", placements: remember(s, panel) };
    });
  }, []);
  // One-click add/remove of a panel from the room header — no Arrange mode.
  // Hiding remembers where it was; showing returns it there, falling back to
  // a smart default side if that spot no longer exists.
  const togglePanel = useCallback((panelId) => {
    setState((s) => {
      const ids = panelsIn(s.tree);
      if (ids.includes(panelId)) {
        if (ids.length <= 1) return s; // keep at least one panel
        const path = findPath(s.tree, panelId);
        if (!path) return s;
        return { ...s, tree: removeAt(s.tree, path), presetId: "custom", placements: remember(s, panelId) };
      }
      const restored = restorePlacement(s.tree, panelId, s.placements?.[panelId]);
      if (restored) return { ...s, tree: restored, presetId: "custom" };
      const { side, frac } = defaultEntry(panelId, ids);
      return { ...s, tree: placeBySide(s.tree, panelId, side, frac), presetId: "custom" };
    });
  }, []);

  return { tree: state.tree, presetId: state.presetId, applyPreset, reset, setRatio, movePanel, addPanel, addPanelAt, closePanel, togglePanel };
}
