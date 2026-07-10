import { useCallback, useRef } from "react";
import { readWbClipboard, writeWbClipboard } from "./wbStorage";
import { freshId } from "./wbUtil";

// Copy / cut / paste for the whiteboard, routed through the in-app clipboard
// (wbStorage) so it works across boards and tabs. Mirrors cloneNodes' id-remap
// + frame-children + internal-edges handling. Extracted from WhiteboardPage.jsx.
//
// Returns the three callbacks plus stable refs to them — the keydown / paste
// handlers read `copyRef.current` etc. so they don't re-subscribe on every
// callback identity change.
export function useWhiteboardClipboard({ rf, setNodes, setEdges, deleteSelected }) {
  // Returns whether anything was copied (so the keydown handler knows whether to
  // swallow the key vs. let the browser copy text).
  const copySelection = useCallback(() => {
    const all = rf.getNodes();
    const sel = new Set(all.filter((n) => n.selected && n.type !== "zone").map((n) => n.id));
    if (!sel.size) return false;
    for (const n of all) if (n.parentId && sel.has(n.parentId)) sel.add(n.id); // frame children ride along
    const clipNodes = all
      .filter((n) => sel.has(n.id))
      .map(({ selected, dragging, resizing, ...rest }) => rest);
    const clipEdges = rf
      .getEdges()
      .filter((e) => sel.has(e.source) && sel.has(e.target)) // edges fully inside the selection
      .map(({ selected, ...rest }) => rest);
    writeWbClipboard({ nodes: clipNodes, edges: clipEdges });
    return true;
  }, [rf]);

  const pasteClipboard = useCallback((at) => {
    const clip = readWbClipboard();
    if (!clip?.nodes?.length) return;
    const idMap = new Map(clip.nodes.map((n) => [n.id, freshId(n.type || "paste")]));
    const isChild = (n) => n.parentId && idMap.has(n.parentId);
    // Drop the cluster under the cursor (or its original spot +offset if we
    // have no pointer yet). Top-level nodes carry absolute positions; framed
    // children stay relative to their (also-pasted) frame.
    const tops = clip.nodes.filter((n) => !isChild(n));
    let dx = 32, dy = 32;
    if (at && tops.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of tops) {
        const x = n.position?.x ?? 0, y = n.position?.y ?? 0;
        const w = n.width ?? n.measured?.width ?? 0, h = n.height ?? n.measured?.height ?? 0;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      }
      dx = at.x - (minX + maxX) / 2;
      dy = at.y - (minY + maxY) / 2;
    }
    const pasted = clip.nodes.map((n) => {
      const next = { ...n, id: idMap.get(n.id), data: { ...n.data }, selected: true };
      if (isChild(n)) {
        next.parentId = idMap.get(n.parentId);   // re-parent to the pasted frame
        next.position = { ...n.position };         // relative → keep
      } else {
        if ("parentId" in next) delete next.parentId; // frame not in the paste → unparent
        next.position = { x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy };
      }
      return next;
    });
    setNodes((nds) =>
      nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(pasted)
    );
    const pastedEdges = (clip.edges || [])
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        ...e,
        id: freshId("e"),
        selected: false,
        source: idMap.get(e.source),
        target: idMap.get(e.target),
        data: e.data ? { ...e.data } : e.data, // anchors are node-relative; route re-bases off the new ends
      }));
    if (pastedEdges.length) setEdges((eds) => eds.concat(pastedEdges));
  }, [rf, setNodes, setEdges]);

  const cutSelection = useCallback(() => {
    if (!copySelection()) return false;
    deleteSelected();
    return true;
  }, [copySelection, deleteSelected]);

  const copyRef = useRef(null); copyRef.current = copySelection;
  const cutRef = useRef(null); cutRef.current = cutSelection;
  const pasteRef = useRef(null); pasteRef.current = pasteClipboard;

  return { copySelection, pasteClipboard, cutSelection, copyRef, cutRef, pasteRef };
}
