import { useRef, useState, useCallback, useEffect } from "react";
import { regionTileKeys } from "./paintTiles";
import { pointInPolygon } from "./wbUtil";

// Bounding box of non-transparent pixels in a canvas, as fractions [0..1] of its
// size (so it maps to rect coords regardless of device-pixel scaling). Sampled
// for speed; null when fully transparent.
function opaquePixelBounds(canvas) {
  try {
    const cw = canvas.width, ch = canvas.height;
    if (!cw || !ch) return null;
    const data = canvas.getContext("2d").getImageData(0, 0, cw, ch).data;
    const step = Math.max(1, Math.floor(Math.max(cw, ch) / 300));
    let minX = cw, minY = ch, maxX = -1, maxY = -1;
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        if (data[(y * cw + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x0: minX / cw, y0: minY / ch, x1: (maxX + step) / cw, y1: (maxY + step) / ch };
  } catch { return null; }
}

// A single bounding box (ABSOLUTE flow coords, padded) tight around the SELECTED
// CONTENT — the union of the picked nodes' bounds and the lifted paint's actual
// painted-pixel bounds. This is the selection box + its interactable area; it
// fits the items, not the (possibly loose) marquee drag rect. null if empty.
function contentBox(rf, picked, rect, raster) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of picked) {
    const inode = rf.getInternalNode(n.id);
    const pos = inode?.internals?.positionAbsolute || n.position;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w); maxY = Math.max(maxY, pos.y + h);
  }
  if (raster) {
    // Expand ONLY for actually-painted pixels. If the lifted region is empty
    // (an allocated-but-transparent paint tile — common where you START a
    // marquee drag), contribute nothing — never pull the blank drag rect in.
    const b = opaquePixelBounds(raster);
    if (b) {
      minX = Math.min(minX, rect.x + b.x0 * rect.w); minY = Math.min(minY, rect.y + b.y0 * rect.h);
      maxX = Math.max(maxX, rect.x + b.x1 * rect.w); maxY = Math.max(maxY, rect.y + b.y1 * rect.h);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const PAD = 8;
  return { x: minX - PAD, y: minY - PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + PAD * 2 };
}
import { WB_TOUCH } from "./wbConstants";

// ── Region select (folded into the SELECT tool) ──────────────────────────────
// A marquee (desktop left-drag / mobile long-press-drag) or lasso grabs
// strokes/notes/shapes + lifts brush paint into a floating move/delete
// selection. Extracted verbatim from WhiteboardEditor.
//
// The three big pointer handlers (onWbPointerDownCapture/Move/Up) stay in
// WhiteboardPage and still drive region-select through the refs/setters this
// hook returns, so those refs must remain accessible to them (call this hook
// ABOVE those handlers). The state values + finalize/commit/delete/cancel
// callbacks + marquee handlers + onEditorClickCapture are returned for the JSX.
export function useWhiteboardRegionSelect({
  rf,
  paintRef,
  setNodes,
  runSilent,
  pushExternalStep,
  broadcastPaintOps,
  tool,
  toolRef,
  penActive,
}) {
  // touch marquee: d3-zoom owns the pane on touch (it needs the touchstart for
  // pinch), so this owns the gesture: kill the pan d3 opened, draw the rect,
  // select intersecting nodes on release.
  const marqueeRef = useRef(null);
  const suppressPaneClickRef = useRef(0);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const marqueePointerDown = (e) => {
    if (!WB_TOUCH || e.pointerType !== "touch" || tool !== "select") return;
    // A palm resting while the Pencil selects/annotates must not start a marquee.
    if (penActive()) return;
    // A floating selection is active → this touch moves it or (tapping off it)
    // deselects; both are handled by onWbPointerDownCapture. Don't arm a marquee.
    if (areaSelRef.current) return;
    const st = marqueeRef.current;
    if (st) {
      // Second finger — it's a pinch, not a marquee.
      if (!st.active) { clearTimeout(st.timer); marqueeRef.current = null; }
      return;
    }
    if (!(e.target instanceof Element)) return;
    const nodeEl = e.target.closest(".react-flow__node");
    if (nodeEl) {
      // Select on POINTERDOWN: Safari treats the first tap on nodes with
      // hover-revealed handles as hover only and eats the click, which made
      // selection take two taps.
      const id = nodeEl.getAttribute("data-id");
      if (id) {
        setNodes((nds) => {
          const t = nds.find((n) => n.id === id);
          if (!t || t.selected || t.type === "zone") return nds;
          return nds.map((n) => (n.id === id ? { ...n, selected: true } : n.selected ? { ...n, selected: false } : n));
        });
      }
      return; // a node press is never a marquee
    }
    if (!e.target.closest(".react-flow__pane")) return;
    const container = e.currentTarget;
    const { clientX: x0, clientY: y0, pointerId: id } = e;
    const timer = setTimeout(() => {
      const cur = marqueeRef.current;
      if (!cur || cur.id !== id) return;
      if (toolRef.current !== "select") {
        marqueeRef.current = null;
        return;
      }
      cur.active = true;
      navigator.vibrate?.(10);
      // End the pan gesture d3-zoom opened on this touch so the canvas
      // doesn't drift under the marquee.
      const pane = container.querySelector(".react-flow__pane");
      try {
        const touch = new Touch({ identifier: id, target: pane, clientX: x0, clientY: y0 });
        pane?.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true, changedTouches: [touch] }));
      } catch { /* Touch() unsupported — worst case the canvas pans slightly */ }
      setMarqueeRect({ x0, y0, x1: x0, y1: y0 });
    }, 350);
    marqueeRef.current = { id, x0, y0, x1: x0, y1: y0, active: false, timer };
  };
  const marqueePointerMove = (e) => {
    const st = marqueeRef.current;
    if (!st || e.pointerId !== st.id) return;
    if (!st.active) {
      // Moved before the hold elapsed — it's a pan; stand down.
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 12) {
        clearTimeout(st.timer);
        marqueeRef.current = null;
      }
      return;
    }
    e.stopPropagation();
    st.x1 = e.clientX;
    st.y1 = e.clientY;
    setMarqueeRect({ x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 });
  };
  const marqueePointerUp = (e) => {
    const st = marqueeRef.current;
    if (!st || e.pointerId !== st.id) return;
    marqueeRef.current = null;
    if (!st.active) { clearTimeout(st.timer); return; }
    e.stopPropagation();
    // The pane fires a click after release, which would clear the fresh
    // selection — swallow it (see onClickCapture below).
    suppressPaneClickRef.current = Date.now() + 500;
    setMarqueeRect(null);
    // Region select (folded in): grab strokes/notes/shapes + lift brush paint
    // into a floating move/delete selection.
    finalizeAreaRef.current?.(st.x0, st.y0, st.x1, st.y1);
  };
  const onEditorClickCapture = (e) => {
    if (Date.now() < suppressPaneClickRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // ── Region select (folded into the SELECT tool): a marquee (desktop
  // left-drag / mobile long-press-drag) grabs strokes/notes/shapes + lifts
  // brush paint into a floating move/delete selection.
  const [areaBox, setAreaBox] = useState(null);   // {x0,y0,x1,y1} SCREEN px while dragging the box
  const areaDragRef = useRef(null);               // { pid, x0, y0 } during the box drag
  const [areaSel, setAreaSel] = useState(null);   // floating selection (see finalizeAreaSelection)
  const areaSelRef = useRef(null);
  areaSelRef.current = areaSel;
  // finalizeAreaSelection is defined far below (it needs rf/paintRef); the
  // pointer-up handler calls it through this ref to avoid a forward-reference
  // TDZ in its dependency array.
  const finalizeAreaRef = useRef(null);
  const moveAreaRef = useRef(null);              // → moveAreaSelection (also forward-defined)
  const commitAreaRef = useRef(null);            // → commitAreaSelection (forward-defined)
  const areaMoveRef = useRef(null);              // { pid, sx, sy, baseDx, baseDy } while dragging the floating selection
  // Lasso tool: draw a freeform path; on release it selects strokes/notes inside
  // the polygon + lifts the polygon-clipped brush paint into the same floating
  // selection as the box marquee.
  const lassoRef = useRef(null);                 // { pid, pts:[[clientX,clientY],...] } while drawing
  const [lassoPath, setLassoPath] = useState(null); // SVG path (screen coords) for the live preview
  const finalizeLassoRef = useRef(null);         // → finalizeLassoSelection (forward-defined)

  // ── Region select: finalize the drag-box into a floating selection ──────
  // Picks the pen strokes (draw nodes) it encloses + LIFTS the raster paint
  // (reads it into a canvas, clears it from the tiles). The floating selection
  // can then be dragged (move) or deleted; committed on tool-change / Done.
  const finalizeAreaSelection = useCallback((sx0, sy0, sx1, sy1) => {
    const minX = Math.min(sx0, sx1), maxX = Math.max(sx0, sx1);
    const minY = Math.min(sy0, sy1), maxY = Math.max(sy0, sy1);
    if (maxX - minX < 6 && maxY - minY < 6) return; // a tap, not a box
    const a = rf.screenToFlowPosition({ x: minX, y: minY });
    const b = rf.screenToFlowPosition({ x: maxX, y: maxY });
    const rect = { x: a.x, y: a.y, w: Math.max(1, b.x - a.x), h: Math.max(1, b.y - a.y) };
    const picked = [];
    for (const n of rf.getNodes()) {
      if (n.type === "zone") continue; // grab strokes, notes, shapes, images, frames — not zones
      const inode = rf.getInternalNode(n.id);
      const pos = inode?.internals?.positionAbsolute || n.position;
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      if (pos.x < rect.x + rect.w && pos.x + w > rect.x && pos.y < rect.y + rect.h && pos.y + h > rect.y) picked.push(n);
    }
    const before = paintRef.current?.snapshot(regionTileKeys(rect), new Map()) || new Map();
    const hadTile = [...before.values()].some((v) => v); // a paint tile EXISTS here
    const raster0 = hadTile ? paintRef.current?.readRegion(rect) : null;
    // Only real (opaque) paint counts — an allocated-but-transparent tile (common
    // where a marquee drag STARTS) must not create an empty selection or expand
    // the box to the blank drag rect.
    const raster = raster0 && opaquePixelBounds(raster0) ? raster0 : null;
    if (raster) paintRef.current?.clearRegion(rect);
    if (!picked.length && !raster) return; // empty area — never select void
    const box = contentBox(rf, picked, rect, raster);
    setAreaSel({ rect, raster, nodes: picked, before, dx: 0, dy: 0, box });
  }, [rf]);
  finalizeAreaRef.current = finalizeAreaSelection;

  // Lasso: same as the box, but the region is a freeform polygon — nodes are
  // picked by centre-in-polygon and the paint is lifted clipped to the shape.
  const finalizeLassoSelection = useCallback((screenPts) => {
    if (!screenPts || screenPts.length < 3) return;
    const poly = screenPts.map((p) => rf.screenToFlowPosition({ x: p[0], y: p[1] }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    const rect = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    if (rect.w < 4 && rect.h < 4) return;
    const picked = [];
    for (const n of rf.getNodes()) {
      if (n.type === "zone") continue;
      const inode = rf.getInternalNode(n.id);
      const pos = inode?.internals?.positionAbsolute || n.position;
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      if (pointInPolygon(pos.x + w / 2, pos.y + h / 2, poly)) picked.push(n);
    }
    const before = paintRef.current?.snapshot(regionTileKeys(rect), new Map()) || new Map();
    const hadTile = [...before.values()].some((v) => v);
    const raster0 = hadTile ? paintRef.current?.readRegion(rect, poly) : null;
    const raster = raster0 && opaquePixelBounds(raster0) ? raster0 : null; // only real paint
    if (raster) paintRef.current?.clearRegion(rect, poly);
    if (!picked.length && !raster) return;
    // Same single content-fitted box as the marquee (the lasso still clips the
    // raster to its freeform shape; the selection box just bounds the result).
    const box = contentBox(rf, picked, rect, raster);
    setAreaSel({ rect, raster, nodes: picked, before, dx: 0, dy: 0, clip: poly, box });
  }, [rf]);
  finalizeLassoRef.current = finalizeLassoSelection;

  // Live-move the floating selection: raster overlay + the picked nodes together.
  const moveAreaSelection = useCallback((dx, dy) => {
    const s = areaSelRef.current;
    if (!s) return;
    setAreaSel((cur) => (cur ? { ...cur, dx, dy } : cur));
    runSilent(() => setNodes((nds) => nds.map((n) => {
      const o = s.nodes.find((m) => m.id === n.id);
      return o ? { ...n, position: { x: o.position.x + dx, y: o.position.y + dy } } : n;
    })));
  }, [setNodes, runSilent]);
  moveAreaRef.current = moveAreaSelection;

  // Commit the floating selection at its current position (stamp raster, keep
  // node positions). One undoable step covers raster + nodes.
  const commitAreaSelection = useCallback(() => {
    const s = areaSelRef.current;
    if (!s) return;
    setAreaSel(null);
    const { rect, raster, nodes, before, dx, dy, clip } = s;
    const destRect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
    if (dx === 0 && dy === 0) { if (raster) paintRef.current?.stampRegion(raster, rect); return; } // no move → drop back (peers never saw the lift)
    // dst pre-stamp pixels — peers need these to undo the move live.
    const dstBefore = raster ? paintRef.current?.readRegion(destRect) : null;
    if (raster) {
      paintRef.current?.snapshot(regionTileKeys(destRect), before);
      paintRef.current?.stampRegion(raster, destRect);
      broadcastPaintOps([{ lift: { src: rect, dst: destRect, clip } }]); // peers recompute the (clipped) move from their own tiles
    }
    pushExternalStep({
      undo: () => runSilent(() => {
        if (before) paintRef.current?.restore(before);
        if (raster) broadcastPaintOps([{ clear: destRect }, { stamp: { rect: destRect, canvas: dstBefore } }, { stamp: { rect, canvas: raster } }]);
        setNodes((nds) => nds.map((n) => {
          const o = nodes.find((m) => m.id === n.id);
          return o ? { ...n, position: { x: o.position.x, y: o.position.y } } : n;
        }));
      }),
      redo: () => runSilent(() => {
        if (raster) { paintRef.current?.clearRegion(rect, clip); paintRef.current?.stampRegion(raster, destRect); broadcastPaintOps([{ lift: { src: rect, dst: destRect, clip } }]); }
        setNodes((nds) => nds.map((n) => {
          const o = nodes.find((m) => m.id === n.id);
          return o ? { ...n, position: { x: o.position.x + dx, y: o.position.y + dy } } : n;
        }));
      }),
    });
  }, [pushExternalStep, runSilent, setNodes, broadcastPaintOps]);
  commitAreaRef.current = commitAreaSelection;

  // Delete the floating selection (raster already lifted; drop nodes).
  const deleteAreaSelection = useCallback(() => {
    const s = areaSelRef.current;
    if (!s) return;
    setAreaSel(null);
    const { rect, raster, nodes, before, clip } = s;
    const ids = new Set(nodes.map((n) => n.id));
    if (raster) broadcastPaintOps([{ clear: rect, clip }]); // peers clear the lifted (clipped) region
    runSilent(() => setNodes((nds) => nds.filter((n) => !ids.has(n.id))));
    pushExternalStep({
      undo: () => runSilent(() => {
        if (before) paintRef.current?.restore(before);
        if (raster) broadcastPaintOps([{ stamp: { rect, canvas: raster } }]); // peers stamp it back (canvas is already clipped)
        setNodes((nds) => nds.filter((n) => !ids.has(n.id)).concat(nodes));
      }),
      redo: () => runSilent(() => {
        paintRef.current?.clearRegion(rect, clip);
        broadcastPaintOps([{ clear: rect, clip }]);
        setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
      }),
    });
  }, [pushExternalStep, runSilent, setNodes, broadcastPaintOps]);

  // Cancel (Escape): put raster + nodes back where they were, no undo step.
  const cancelAreaSelection = useCallback(() => {
    const s = areaSelRef.current;
    if (!s) return;
    setAreaSel(null);
    const { nodes, before } = s;
    runSilent(() => {
      if (before) paintRef.current?.restore(before);
      setNodes((nds) => nds.map((n) => {
        const o = nodes.find((m) => m.id === n.id);
        return o ? { ...n, position: { x: o.position.x, y: o.position.y } } : n;
      }));
    });
  }, [runSilent, setNodes]);

  // Leaving the select-area tool commits any floating selection.
  useEffect(() => {
    if (tool !== "select" && tool !== "lasso" && areaSelRef.current) commitAreaSelection();
  }, [tool, commitAreaSelection]);

  return {
    // state values (JSX overlays)
    marqueeRect,
    areaBox,
    areaSel,
    lassoPath,
    // refs (used by the untouched pointer handlers in WhiteboardPage)
    areaDragRef,
    areaMoveRef,
    lassoRef,
    areaSelRef,
    moveAreaRef,
    commitAreaRef,
    finalizeAreaRef,
    finalizeLassoRef,
    // setters (used by the untouched pointer handlers)
    setAreaBox,
    setLassoPath,
    // handlers (JSX)
    marqueePointerDown,
    marqueePointerMove,
    marqueePointerUp,
    onEditorClickCapture,
    // selection actions (JSX + keyboard)
    deleteAreaSelection,
    commitAreaSelection,
    cancelAreaSelection,
  };
}
