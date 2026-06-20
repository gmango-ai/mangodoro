import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, MarkerType, useReactFlow } from "@xyflow/react";
import { Type, Minus, Spline, MoveRight, AlignJustify, Sparkles } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { Pill, ToolDivider, Dropdown, SwatchGrid } from "./toolbarUI";
import { routeAround, sideNormal } from "./routing";

// Custom end-cap markers (dot + diamond). fill:context-stroke makes them
// follow each edge's stroke colour, so they recolour for free.
export function EdgeMarkerDefs() {
  return (
    <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <marker id="wb-dot" markerWidth="8" markerHeight="8" refX="4" refY="4" markerUnits="strokeWidth" orient="auto">
          <circle cx="4" cy="4" r="3" fill="context-stroke" />
        </marker>
        <marker id="wb-diamond" markerWidth="11" markerHeight="11" refX="5.5" refY="5.5" markerUnits="strokeWidth" orient="auto">
          <path d="M5.5 1 L10 5.5 L5.5 10 L1 5.5 Z" fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  );
}

const STUB = 22; // min distance an edge travels perpendicular before bending

function stubDir(pos) {
  return pos === "left" ? [-1, 0] : pos === "right" ? [1, 0] : pos === "top" ? [0, -1] : [0, 1];
}

// Default orthogonal route between two handles → interior corner points
// (source & target are implicit). Exits each node via a perpendicular stub.
function autoOrtho(sx, sy, sp, tx, ty, tp) {
  const [sdx, sdy] = stubDir(sp);
  const [tdx, tdy] = stubDir(tp);
  const s1 = { x: sx + sdx * STUB, y: sy + sdy * STUB };
  const t1 = { x: tx + tdx * STUB, y: ty + tdy * STUB };
  const sHoriz = sdx !== 0, tHoriz = tdx !== 0;
  const mids = [];
  if (sHoriz && tHoriz) { const mx = (s1.x + t1.x) / 2; mids.push({ x: mx, y: s1.y }, { x: mx, y: t1.y }); }
  else if (!sHoriz && !tHoriz) { const my = (s1.y + t1.y) / 2; mids.push({ x: s1.x, y: my }, { x: t1.x, y: my }); }
  else if (sHoriz && !tHoriz) { mids.push({ x: t1.x, y: s1.y }); }
  else { mids.push({ x: s1.x, y: t1.y }); }
  return [s1, ...mids, t1];
}

// Force every segment axis-aligned: insert a corner wherever two points
// are diagonal, so an elbow is ALWAYS horizontal/vertical (never angled),
// even after a connected node moves and a stub goes stale.
function orthogonalize(points) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      const prev = out[out.length - 2];
      const prevHoriz = prev ? (Math.abs(prev.y - a.y) < 0.5 && Math.abs(prev.x - a.x) > 0.5) : null;
      if (prevHoriz === true) out.push({ x: a.x, y: b.y });        // turn vertical
      else if (prevHoriz === false) out.push({ x: b.x, y: a.y });  // turn horizontal
      else out.push(Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
    out.push(b);
  }
  return out;
}

// Rounded polyline through points — small r = sharp elbow, large = smooth.
function roundedPath(points, r = 8) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1], c = points[i], n = points[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const outLen = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    const ri = Math.min(r, inLen / 2), ro = Math.min(r, outLen / 2);
    const a = { x: c.x - ((c.x - p.x) / inLen) * ri, y: c.y - ((c.y - p.y) / inLen) * ri };
    const b = { x: c.x + ((n.x - c.x) / outLen) * ro, y: c.y + ((n.y - c.y) / outLen) * ro };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

function pointAtT(d, t) {
  try {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    const len = el.getTotalLength();
    if (!len) return null;
    const p = el.getPointAtLength(Math.max(0, Math.min(1, t)) * len);
    return { x: p.x, y: p.y };
  } catch { return null; }
}

function nearestT(d, px, py) {
  try {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    const len = el.getTotalLength();
    if (!len) return 0.5;
    let bestT = 0.5, bd = Infinity;
    for (let i = 0; i <= 100; i++) {
      const pt = el.getPointAtLength((i / 100) * len);
      const dd = (pt.x - px) ** 2 + (pt.y - py) ** 2;
      if (dd < bd) { bd = dd; bestT = i / 100; }
    }
    return bestT;
  } catch { return 0.5; }
}

// ─── Contextual edge toolbar (FigJam/Lucidchart style) ────────────
// Shared dark-pill primitives (Pill / Dropdown / SwatchGrid) live in
// ./toolbarUI so the node toolbar matches this exactly.

const WEIGHTS = [["Thin", 1.5], ["Medium", 2], ["Thick", 3.5]];
const LINES = [["Solid", ""], ["Dashed", "6 4"], ["Dotted", "1.5 5"]];
const ROUTES = [
  { label: "Elbow", routing: "elbow" },
  { label: "Curve", routing: "curve", curviness: 18 },
  { label: "Smooth", routing: "curve", curviness: 44 },
];
const EDGE_CAPS = [["None", "none"], ["Arrow", "arrow"], ["Open arrow", "open"], ["Dot", "dot"], ["Diamond", "diamond"]];

function capMarker(kind, color) {
  switch (kind) {
    case "arrow": return { type: MarkerType.ArrowClosed, color };
    case "open": return { type: MarkerType.Arrow, color };
    case "dot": return "url(#wb-dot)";
    case "diamond": return "url(#wb-diamond)";
    default: return undefined;
  }
}

function EdgeToolbar({ x, y, style, data, patchEdge, onEditLabel }) {
  const [open, setOpen] = useState(null);
  const color = style?.stroke || "#0ea5e9";
  const width = style?.strokeWidth || 2;
  const dash = style?.strokeDasharray || "";
  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  const endCap = data?.endCap || "arrow";
  const setStyle = (p) => patchEdge({ style: { ...style, ...p } });
  const opt = (active, onClick, label) => (
    <button key={label} type="button" onClick={() => { onClick(); setOpen(null); }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}>
      {label}
    </button>
  );
  return (
    <div className="nodrag nopan" style={{ position: "absolute", transform: `translate(-50%,-100%) translate(${x}px,${y - 18}px)`, pointerEvents: "all", zIndex: 50 }}>
      <Pill>
        <Dropdown openKey="color" open={open} setOpen={setOpen} icon={<span className="w-4 h-4 rounded-full border border-white/30" style={{ background: color }} />}>
          <SwatchGrid value={color} onPick={(c) => patchEdge({ style: { ...style, stroke: c }, ...(endCap !== "none" ? { markerEnd: capMarker(endCap, c) } : {}) })} />
        </Dropdown>
        <Dropdown openKey="weight" open={open} setOpen={setOpen} icon={<AlignJustify className="w-4 h-4" />}>
          {WEIGHTS.map(([l, v]) => opt(width === v, () => setStyle({ strokeWidth: v }), l))}
        </Dropdown>
        <Dropdown openKey="text" open={open} setOpen={setOpen} icon={<Type className="w-4 h-4" />}>
          <div className="min-w-[236px]">
            {opt(false, onEditLabel, "Edit text")}
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/40 px-2 pt-1.5 pb-1">Padding</div>
            <div className="flex gap-1 px-1.5 pb-1">
              {[["S", "s"], ["M", "m"], ["L", "l"]].map(([l, k]) => (
                <button key={k} type="button" onClick={() => patchEdge({ data: { ...data, labelPad: k } })}
                  className={`flex-1 px-2 py-1 rounded text-[12px] ${(data?.labelPad || "m") === k ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}>{l}</button>
              ))}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/40 px-2 pt-1">Text colour</div>
            <SwatchGrid value={data?.labelTextColor} onPick={(c) => patchEdge({ data: { ...data, labelTextColor: c } })} />
            <div className="flex items-center justify-between px-2 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-white/40">Background</span>
              <button type="button" onClick={() => patchEdge({ data: { ...data, labelBg: undefined } })}
                className={`px-2 py-0.5 rounded text-[11px] ${!data?.labelBg ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"}`}>None</button>
            </div>
            <SwatchGrid value={data?.labelBg} onPick={(c) => patchEdge({ data: { ...data, labelBg: c } })} />
          </div>
        </Dropdown>
        <ToolDivider />
        <Dropdown openKey="line" open={open} setOpen={setOpen} icon={<Minus className="w-4 h-4" />}>
          {LINES.map(([l, d]) => opt(dash === d, () => setStyle({ strokeDasharray: d || undefined }), l))}
        </Dropdown>
        <Dropdown openKey="route" open={open} setOpen={setOpen} icon={<Spline className="w-4 h-4" />}>
          {ROUTES.map((r) => opt(
            routing === r.routing && (r.routing === "elbow" || curviness === r.curviness),
            () => patchEdge({ data: { ...data, routing: r.routing, curviness: r.curviness } }),
            r.label,
          ))}
        </Dropdown>
        <Dropdown openKey="cap" open={open} setOpen={setOpen} icon={<MoveRight className="w-4 h-4" />}>
          {EDGE_CAPS.map(([l, k]) => opt(endCap === k, () => patchEdge({ markerEnd: capMarker(k, color), data: { ...data, endCap: k } }), l))}
        </Dropdown>
        <ToolDivider />
        <button type="button" title="Tidy — auto-route around nodes"
          onClick={() => patchEdge({ data: { ...data, autoRoute: true, route: undefined } })}
          className="h-7 px-1.5 rounded-md flex items-center text-white/90 hover:bg-white/10">
          <Sparkles className="w-4 h-4" />
        </button>
      </Pill>
    </div>
  );
}

// ── Free connection anchors ─────────────────────────────────────────
// An edge end can be pinned to ANY point around a node's perimeter
// (data.sourceAnchor / targetAnchor = { side, t }) instead of a fixed
// handle. We resolve it against the live node rect on every render.
export function nodeRect(node) {
  if (!node) return null;
  const p = node.internals?.positionAbsolute || node.position || { x: 0, y: 0 };
  const w = node.measured?.width ?? node.width ?? 0;
  const h = node.measured?.height ?? node.height ?? 0;
  if (!w || !h) return null;
  return { x: p.x, y: p.y, w, h };
}
// Anchor side → xyflow handle id, used when creating an edge so its
// fallback handle matches the free anchor.
export const ANCHOR_TO_HANDLE = { top: "t", right: "r", bottom: "b", left: "l" };
function anchorPoint(rect, anchor) {
  if (!rect || !anchor) return null;
  const t = Math.max(0, Math.min(1, anchor.t ?? 0.5));
  switch (anchor.side) {
    case "top": return { x: rect.x + rect.w * t, y: rect.y, pos: "top" };
    case "bottom": return { x: rect.x + rect.w * t, y: rect.y + rect.h, pos: "bottom" };
    case "left": return { x: rect.x, y: rect.y + rect.h * t, pos: "left" };
    case "right": return { x: rect.x + rect.w, y: rect.y + rect.h * t, pos: "right" };
    default: return null;
  }
}
// Snap a free-dragged point to the nearest side of the node, as { side, t }.
export function projectToPerimeter(rect, px, py) {
  const { x, y, w, h } = rect;
  const dl = Math.abs(px - x), dr = Math.abs(px - (x + w));
  const dt = Math.abs(py - y), db = Math.abs(py - (y + h));
  const m = Math.min(dl, dr, dt, db);
  const tx = w ? Math.max(0, Math.min(1, (px - x) / w)) : 0.5;
  const ty = h ? Math.max(0, Math.min(1, (py - y) / h)) : 0.5;
  if (m === dt) return { side: "top", t: tx };
  if (m === db) return { side: "bottom", t: tx };
  if (m === dl) return { side: "left", t: ty };
  return { side: "right", t: ty };
}

// Editable edge: an orthogonal route whose straight segments you drag
// (rectangle handles) to reshape — FigJam-style. Double-click anywhere on
// the line to drop a label there. Endpoints can be dragged to any spot
// around the connected node's perimeter.
const EditableEdge = memo(function EditableEdge({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  markerStart, markerEnd, style, data, selected,
}) {
  const { setEdges, screenToFlowPosition, getNode, getNodes } = useReactFlow();

  // Resolve free perimeter anchors against the live node rects; fall back
  // to xyflow's handle-based endpoints when no anchor is set.
  const sa = anchorPoint(nodeRect(source ? getNode(source) : null), data?.sourceAnchor);
  const ta = anchorPoint(nodeRect(target ? getNode(target) : null), data?.targetAnchor);
  const sX = sa ? sa.x : sourceX, sY = sa ? sa.y : sourceY, sPos = sa ? sa.pos : sourcePosition;
  const tX = ta ? ta.x : targetX, tY = ta ? ta.y : targetY, tPos = ta ? ta.pos : targetPosition;
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(data?.label || "");
  const inputRef = useRef(null);
  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  // Obstacle-avoiding route, computed LIVE in render so a dragged node's
  // edges re-flow in real time (no debounce, no snap-after-settle). The A*
  // is cheap (routing.js) and — thanks to memo() — only edges whose OWN
  // endpoints move re-render, so per-frame cost is bounded to the dragged
  // node's edges. Pinned (manually reshaped) edges and curves are skipped.
  // Nothing is written to data here, so there's no save/sync churn while
  // dragging; peers recompute the same route from synced node positions.
  const pinned = data?.autoRoute === false;
  const obstacleRoute = useMemo(() => {
    if (pinned || (data?.routing || "elbow") === "curve") return null;
    const obstacles = [];
    for (const n of getNodes()) {
      if (n.id === source || n.id === target || n.type === "zone" || n.type === "frame") continue;
      const r = nodeRect(n);
      if (r) obstacles.push(r);
    }
    if (!obstacles.length) return null;
    return routeAround({ x: sX, y: sY }, sideNormal(sPos), { x: tX, y: tY }, sideNormal(tPos), obstacles);
  }, [pinned, data?.routing, source, target, sX, sY, sPos, tX, tY, tPos, getNodes]);

  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  // Pinned → the hand-shaped route; auto → the live obstacle route; else the
  // simple elbow.
  const interior = (pinned && data?.route?.length)
    ? data.route
    : (obstacleRoute && obstacleRoute.length ? obstacleRoute : autoOrtho(sX, sY, sPos, tX, tY, tPos));
  const rawFull = [{ x: sX, y: sY }, ...interior, { x: tX, y: tY }];
  // Elbows are squared off — every segment forced horizontal/vertical, even
  // after a node moves and a stub goes stale. Curves keep their diagonals.
  const full = routing === "curve" ? rawFull : orthogonalize(rawFull);
  // The polyline currently on screen — used by the segment/delete handlers
  // so a grabbed handle maps to the route the user actually sees.
  const fullRef = useRef(full);
  fullRef.current = full;
  const path = roundedPath(full, routing === "curve" ? Math.min(curviness, 30) : 8);
  const labelPt = pointAtT(path, data?.labelT ?? 0.5) || { x: (sX + tX) / 2, y: (sY + tY) / 2 };
  // The toolbar always floats above the edge's highest point (smallest y),
  // not wherever the label happens to sit, so it never overlaps the line.
  // Centre it across the topmost run so a flat edge gets a centred toolbar
  // instead of one pinned over an endpoint.
  const minY = Math.min(...full.map((p) => p.y));
  const topXs = full.filter((p) => p.y <= minY + 0.5).map((p) => p.x);
  const topPt = { x: (Math.min(...topXs) + Math.max(...topXs)) / 2, y: minY };

  const label = data?.label || "";
  const color = style?.stroke || "#0ea5e9";
  const { theme } = useTheme();
  // Label background defaults to the canvas colour, which reads as "no pill"
  // while still masking the line behind the text (the masked area grows with
  // the padding). A coloured pill is opt-in via `labelBg`. Padding adjustable.
  const canvasC = theme === "dark" ? "#0f172a" : "#fbf6ee";
  const pillColor = data?.labelBg;
  const labelTextColor = data?.labelTextColor || (pillColor ? "#fff" : color);
  const labelPad = { s: "0px 4px", m: "1px 7px", l: "3px 11px" }[data?.labelPad || "m"];
  const labelBg = {
    background: pillColor || canvasC,
    color: labelTextColor,
    padding: labelPad,
    textAlign: "center",
  };

  const patchData = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
  }, [id, setEdges]);
  const patchEdge = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, [id, setEdges]);
  const commit = useCallback(() => {
    const v = draft.trim();
    patchData({ label: v || undefined });
    setEditing(false);
  }, [draft, patchData]);

  // Drag the label, locked to the path (stores the nearest length-fraction).
  const dragLabel = useCallback((e) => {
    e.stopPropagation();
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", path);
    let len = 0; try { len = el.getTotalLength(); } catch { /* */ }
    if (!len) return;
    const samples = [];
    for (let i = 0; i <= 100; i++) { const pt = el.getPointAtLength((i / 100) * len); samples.push({ t: i / 100, x: pt.x, y: pt.y }); }
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      let best = samples[0], bd = Infinity;
      for (const s of samples) { const dx = s.x - p.x, dy = s.y - p.y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
      patchData({ labelT: best.t });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [path, screenToFlowPosition, patchData]);

  // Drag a straight segment perpendicular; its two corner endpoints move
  // together, so the route stays orthogonal and the neighbours stretch.
  const dragSeg = useCallback((fullIndex, horiz, e) => {
    e.stopPropagation();
    // Snapshot the polyline currently on screen ONCE at drag start (the live
    // obstacle route or the pinned one), so the grabbed handle maps to the
    // right segment and the route can't shift under the drag.
    const base = fullRef.current.map((pt) => ({ ...pt }));
    if (!base[fullIndex] || !base[fullIndex + 1]) return;
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const pts = base.map((pt) => ({ ...pt }));
      if (horiz) { pts[fullIndex].y = p.y; pts[fullIndex + 1].y = p.y; }
      else { pts[fullIndex].x = p.x; pts[fullIndex + 1].x = p.x; }
      setEdges((eds) => eds.map((edge) => (
        edge.id === id ? { ...edge, data: { ...edge.data, route: pts.slice(1, -1), autoRoute: false } } : edge
      )));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [id, screenToFlowPosition, setEdges]);

  // Double-click a segment handle to delete that section: drop its two
  // corner points and let the route re-square around the gap.
  const deleteSeg = useCallback((fullIndex, e) => {
    e.stopPropagation();
    e.preventDefault();
    const trimmed = fullRef.current.filter((_, idx) => idx !== fullIndex && idx !== fullIndex + 1);
    const nextInterior = trimmed.slice(1, -1);
    // Deleting a section is a manual edit → pin so the auto-router doesn't
    // immediately restore the removed bend.
    setEdges((eds) => eds.map((edge) => (
      edge.id === id ? { ...edge, data: { ...edge.data, route: nextInterior.length ? nextInterior : undefined, autoRoute: false } } : edge
    )));
  }, [id, setEdges]);

  // Drag an endpoint to move it around its node's perimeter OR drop it on
  // another node (or back on the parent) to re-attach this end there.
  const dragEndpoint = useCallback((which, e) => {
    e.stopPropagation();
    const key = which === "source" ? "sourceAnchor" : "targetAnchor";
    const endKey = which === "source" ? "source" : "target";
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      // Node under the cursor → the re-attach target (skip containers).
      let hit = null;
      for (const n of getNodes()) {
        if (n.type === "frame" || n.type === "zone") continue;
        const r = nodeRect(n);
        if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { hit = n; break; }
      }
      const overId = hit ? hit.id : (which === "source" ? source : target);
      const rect = nodeRect(hit || getNode(overId));
      if (!rect) return;
      const anchor = projectToPerimeter(rect, p.x, p.y);
      // Clear custom bends so the route re-squares cleanly from the new end.
      setEdges((eds) => eds.map((edge) => {
        if (edge.id !== id) return edge;
        const next = { ...edge, data: { ...edge.data, [key]: anchor, route: undefined } };
        if (hit && edge[endKey] !== hit.id) next[endKey] = hit.id; // re-attach
        return next;
      }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [id, source, target, getNode, getNodes, screenToFlowPosition, setEdges]);

  const onEdgeDblClick = useCallback((e) => {
    e.stopPropagation();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    patchData({ labelT: nearestT(path, p.x, p.y) });
    setEditing(true);
  }, [path, screenToFlowPosition, patchData]);

  // Hover with a short leave-delay so moving from the line onto an endpoint
  // handle (a separate layer) doesn't unmount it before you can grab it.
  const hoverTimer = useRef(null);
  const enterHover = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHovered(true);
  }, []);
  const leaveHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(false), 140);
  }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  // Draggable interior segments (exclude the two perpendicular stubs).
  const segHandles = [];
  for (let i = 1; i <= full.length - 3; i++) {
    const a = full[i], b = full[i + 1];
    segHandles.push({ i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horiz: Math.abs(a.y - b.y) < 0.5 });
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      {/* Wide invisible hit-path: double-click anywhere to label; hover
          surfaces the endpoint handles so you can grab an end to re-route. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={22} style={{ cursor: "text" }}
        onDoubleClick={onEdgeDblClick}
        onPointerEnter={enterHover}
        onPointerLeave={leaveHover} />
      <EdgeLabelRenderer>
        {selected && (
          <EdgeToolbar x={topPt.x} y={topPt.y} style={style} data={data} patchEdge={patchEdge} onEditLabel={() => setEditing(true)} />
        )}

        {(editing || label) && (
          <div className="nodrag nopan"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y}px)`, pointerEvents: "all", cursor: editing ? "text" : "grab", zIndex: 6 }}
            onPointerDown={editing ? undefined : dragLabel}
            onDoubleClick={() => setEditing(true)}>
            {editing ? (
              <input ref={inputRef} value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 80))}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { setDraft(label); setEditing(false); } }}
                placeholder="Add text"
                className="text-[11px] font-semibold rounded-md outline-none text-center"
                style={{ ...labelBg, width: Math.max(60, draft.length * 7 + 24) }} />
            ) : (
              <span className="text-[11px] font-semibold rounded-md" style={labelBg} title="Drag to move · double-click to edit">{label}</span>
            )}
          </div>
        )}

        {selected && segHandles.map((h) => (
          <div key={`seg-${h.i}`} className="nodrag nopan"
            onPointerDown={(e) => dragSeg(h.i, h.horiz, e)}
            onDoubleClick={(e) => deleteSeg(h.i, e)}
            title="Drag to move · double-click to remove this section"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${h.x}px,${h.y}px)`,
              pointerEvents: "all", zIndex: 4,
              width: h.horiz ? 22 : 9, height: h.horiz ? 9 : 22, borderRadius: 4,
              background: color, border: "2px solid #fff",
              cursor: h.horiz ? "ns-resize" : "ew-resize",
              boxShadow: "0 1px 4px rgba(0,0,0,.4)",
            }} />
        ))}
        {/* Endpoint handles: shown on hover or selection, sitting right ON
            the endpoint. They live in the edge-label layer (above the node
            layer) so they win the click over the node's connection dot —
            and because they're not a child of the node, grabbing one does
            NOT reveal the node's dots. Drag to slide the end anywhere around
            the perimeter, or drop on another node to re-attach. This moves
            the EXISTING edge (never spawns a new one). */}
        {(selected || hovered) && [
          { which: "source", x: sX, y: sY },
          { which: "target", x: tX, y: tY },
        ].map((ep) => (
          <div key={`ep-${ep.which}`} className="nodrag nopan"
            onPointerEnter={enterHover}
            onPointerLeave={leaveHover}
            onPointerDown={(e) => dragEndpoint(ep.which, e)}
            title="Drag to move this end · drop on a node to re-attach"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${ep.x}px,${ep.y}px)`,
              pointerEvents: "all", zIndex: 9,
              width: 16, height: 16, borderRadius: 9999,
              background: "#fff", border: `3px solid ${color}`,
              cursor: "grab", boxShadow: "0 1px 4px rgba(0,0,0,.4)",
            }} />
        ))}
      </EdgeLabelRenderer>
    </>
  );
});

export const SIDE_POS = { r: "right", l: "left", t: "top", b: "bottom" };

// ── Connected-node placement (shared by preview + real drop) ────────
// Keeping this in one place is what makes the drag ghost land EXACTLY
// where the node actually spawns.

// DROP: release at (toX,toY) pulling from a source whose centre is
// srcCenter → the new node grows away from the source, with its entering
// edge sitting on the release point. Returns {x,y, side} (side = the new
// node's target-handle side).
export function connectedNodePlacement(srcCenter, toX, toY, size) {
  const dx = srcCenter.x - toX;
  const dy = srcCenter.y - toY;
  const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t");
  let x = toX - size.w / 2, y = toY - size.h / 2;
  if (side === "r") x = toX - size.w;
  else if (side === "l") x = toX;
  else if (side === "b") y = toY - size.h;
  else if (side === "t") y = toY;
  return { x, y, side };
}

// CLICK (no drag): drop a same-size sibling beside the parent on the
// pulled handle's side, gapped and aligned to the parent's centre axis.
export function siblingPlacement(srcRect, fromSide, size, gap = 56) {
  const cx = srcRect.x + srcRect.w / 2;
  const cy = srcRect.y + srcRect.h / 2;
  if (fromSide === "l") return { x: srcRect.x - gap - size.w, y: cy - size.h / 2, side: "r" };
  if (fromSide === "t") return { x: cx - size.w / 2, y: srcRect.y - gap - size.h, side: "b" };
  if (fromSide === "b") return { x: cx - size.w / 2, y: srcRect.y + srcRect.h + gap, side: "t" };
  return { x: srcRect.x + srcRect.w + gap, y: cy - size.h / 2, side: "l" }; // right (default)
}

// Preview shown while pulling a new connection (FigJam/Lucidchart style):
// a smooth orthogonal route that follows the cursor, a "+" drop affordance,
// and — over empty canvas — a faint ghost of the node a drop would create,
// sized to the parent and placed via the SAME helper as the real drop.
export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, fromNode }) {
  const { getNodes } = useReactFlow();
  const fp = fromPosition || "right";

  // Is the cursor over an existing node? If so we'll connect to it at the
  // exact projected point (snap to any side), so preview THAT instead of
  // the new-node ghost.
  let over = null;
  for (const n of getNodes()) {
    if (n.type === "frame" || n.type === "zone") continue;
    if (fromNode && n.id === fromNode.id) continue;
    const r = nodeRect(n);
    if (r && toX >= r.x && toX <= r.x + r.w && toY >= r.y && toY <= r.y + r.h) { over = r; break; }
  }

  if (over) {
    const ap = anchorPoint(over, projectToPerimeter(over, toX, toY));
    const interior = autoOrtho(fromX, fromY, fp, ap.x, ap.y, ap.pos);
    const d = roundedPath(orthogonalize([{ x: fromX, y: fromY }, ...interior, { x: ap.x, y: ap.y }]), 12);
    return (
      <g>
        <path fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d={d} />
        <circle cx={fromX} cy={fromY} r={3.5} fill="#22c55e" />
        <circle cx={ap.x} cy={ap.y} r={6} fill="rgba(34,197,94,.2)" stroke="#22c55e" strokeWidth={2.5} />
      </g>
    );
  }

  // Over empty canvas → ghost of the node a drop would create + "+" cursor.
  const accent = "#64748b";
  const sw = fromNode?.measured?.width ?? fromNode?.width ?? 150;
  const sh = fromNode?.measured?.height ?? fromNode?.height ?? 90;
  const center = fromNode?.position
    ? { x: fromNode.position.x + sw / 2, y: fromNode.position.y + sh / 2 }
    : { x: fromX, y: fromY };
  const { x: gx, y: gy, side } = connectedNodePlacement(center, toX, toY, { w: sw, h: sh });
  const interior = autoOrtho(fromX, fromY, fp, toX, toY, SIDE_POS[side]);
  const d = roundedPath(orthogonalize([{ x: fromX, y: fromY }, ...interior, { x: toX, y: toY }]), 12);
  return (
    <g>
      <path fill="none" stroke={accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d={d} />
      <circle cx={fromX} cy={fromY} r={3.5} fill={accent} />
      <rect x={gx} y={gy} width={sw} height={sh} rx={12}
        fill="rgba(100,116,139,.06)" stroke={accent} strokeWidth={1.5} strokeDasharray="6 5" opacity={0.6} />
      <g transform={`translate(${toX},${toY})`}>
        <circle r={9} fill="#fff" stroke={accent} strokeWidth={2.5} />
        <path d="M-4 0 H4 M0 -4 V4" stroke={accent} strokeWidth={2} strokeLinecap="round" />
      </g>
    </g>
  );
}

export const EDGE_TYPES = { editable: EditableEdge };
