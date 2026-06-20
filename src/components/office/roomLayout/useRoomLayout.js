import { useCallback, useEffect, useRef, useState } from "react";
import { presetTree, DEFAULT_PRESET } from "./presets";
import { setRatioAt, sanitize, movePanelInTree, addPanelToTree, addPanelAtTree, removeAt, findPath, panelsIn } from "./layoutTree";

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
      if (tree) return { tree, presetId: parsed.presetId || "custom" };
    }
  } catch { /* */ }
  return { tree: presetTree(DEFAULT_PRESET), presetId: DEFAULT_PRESET };
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

  const applyPreset = useCallback((id) => setState({ tree: presetTree(id), presetId: id }), []);
  const reset = useCallback(() => setState({ tree: presetTree(DEFAULT_PRESET), presetId: DEFAULT_PRESET }), []);
  const setRatio = useCallback((path, ratio) => {
    setState((s) => ({ tree: setRatioAt(s.tree, path, ratio), presetId: "custom" }));
  }, []);
  const movePanel = useCallback((dragged, target, zone) => {
    setState((s) => ({ tree: movePanelInTree(s.tree, dragged, target, zone), presetId: "custom" }));
  }, []);
  const addPanel = useCallback((panel) => {
    setState((s) => ({ tree: addPanelToTree(s.tree, panel), presetId: "custom" }));
  }, []);
  const addPanelAt = useCallback((panel, target, side) => {
    setState((s) => ({ tree: addPanelAtTree(s.tree, panel, target, side), presetId: "custom" }));
  }, []);
  const closePanel = useCallback((panel) => {
    setState((s) => {
      if (panelsIn(s.tree).length <= 1) return s; // never close the last tile
      const path = findPath(s.tree, panel);
      if (!path) return s;
      return { tree: removeAt(s.tree, path), presetId: "custom" };
    });
  }, []);

  return { tree: state.tree, presetId: state.presetId, applyPreset, reset, setRatio, movePanel, addPanel, addPanelAt, closePanel };
}
