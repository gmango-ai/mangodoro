import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, useStore } from "@xyflow/react";
import { Type, Minus, Spline, AlignJustify, Sparkles } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { Pill, ToolDivider, Dropdown, SwatchGrid } from "./toolbarUI";
import { routeAround, sideNormal, MARGIN } from "./routing";
import { snapToGrid } from "./snapping";
import { ShapeSvg } from "./nodes";

// Provided by WhiteboardPage: the shape the current connect-drag will create
// (picked via number keys), so the live ghost matches. Null → mirror the parent.
export const ConnectShapeContext = createContext(null);
const LEGACY_GHOST = { rect: "process", ellipse: "ellipse", diamond: "diamond" };

// Custom end-cap markers (dot + diamond). fill:context-stroke makes them
// follow each edge's stroke colour, so they recolour for free.
export function EdgeMarkerDefs() {
  // All four end-caps as custom markers so BOTH ends can use any of them and
  // dot/diamond render reliably (we set the path's marker-start/end ourselves
  // rather than relying on React Flow's object-marker generation). orient
  // "auto-start-reverse" makes directional caps point the right way on EITHER
  // end; fill/stroke "context-stroke" follows each edge's colour for free.
  return (
    <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <marker id="wb-arrow" markerWidth="10" markerHeight="10" refX="8.5" refY="5" markerUnits="strokeWidth" orient="auto-start-reverse">
          <path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="context-stroke" />
        </marker>
        <marker id="wb-open" markerWidth="10" markerHeight="10" refX="8.5" refY="5" markerUnits="strokeWidth" orient="auto-start-reverse">
          <path d="M2 1.5 L9 5 L2 8.5" fill="none" stroke="context-stroke" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="wb-dot" markerWidth="8" markerHeight="8" refX="4" refY="4" markerUnits="strokeWidth" orient="auto-start-reverse">
          <circle cx="4" cy="4" r="3" fill="context-stroke" />
        </marker>
        <marker id="wb-diamond" markerWidth="11" markerHeight="11" refX="5.5" refY="5.5" markerUnits="strokeWidth" orient="auto-start-reverse">
          <path d="M5.5 1 L10 5.5 L5.5 10 L1 5.5 Z" fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  );
}

const STUB = 22; // min distance an edge travels perpendicular before bending

// Edges only attach to flowchart shapes. Containers and content nodes —
// frames, zones, sticky notes, goals — are never edge endpoints.
export const NON_CONNECTABLE = new Set(["frame", "zone", "sticky", "goal", "draw"]);

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

// Re-base a hand-shaped route relative to its endpoints. The bends are stored
// in ABSOLUTE coords (data.route) alongside the endpoints they were drawn
// against (data.routeFrame). Each render we remap every bend so the shape moves
// with the nodes instead of freezing in space.
//
// We TRANSLATE, never scale: each bend shifts by a CONVEX blend of how the two
// endpoints moved — bends early in the path follow the source, late ones the
// target. Weight is INDEX-based (0..1), not spatial, so a bend that sits
// OUTSIDE the endpoints' span (a loop or a wrap) still moves WITH the nodes and
// never inverts or extrapolates — scaling did exactly that and was the bug.
// Then we re-lock orthogonality: any segment axis-aligned in the ORIGINAL route
// stays axis-aligned, so the per-bend blend can't shear a straight run into a
// staircase. Legacy routes (no frame) pass through unchanged.
function rebaseRoute(route, frame, S, T) {
  if (!frame || !route?.length) return route;
  const dSx = S.x - frame.sx, dSy = S.y - frame.sy; // how the source endpoint moved
  const dTx = T.x - frame.tx, dTy = T.y - frame.ty; // how the target endpoint moved
  const n = route.length;
  const out = route.map((p, i) => {
    const w = n > 1 ? i / (n - 1) : 0.5;
    return { x: p.x + dSx * (1 - w) + dTx * w, y: p.y + dSy * (1 - w) + dTy * w };
  });
  // Propagate each shared coordinate OUTWARD from the ends, so the end bends —
  // which anchor the perpendicular stubs — keep their endpoint-relative spot.
  const mid = Math.floor((n - 1) / 2);
  for (let i = 0; i < mid; i++) {                    // first half ← source side
    if (Math.abs(route[i].x - route[i + 1].x) < 0.5) out[i + 1].x = out[i].x;
    if (Math.abs(route[i].y - route[i + 1].y) < 0.5) out[i + 1].y = out[i].y;
  }
  for (let i = n - 2; i >= mid; i--) {               // second half ← target side
    if (Math.abs(route[i].x - route[i + 1].x) < 0.5) out[i].x = out[i + 1].x;
    if (Math.abs(route[i].y - route[i + 1].y) < 0.5) out[i].y = out[i + 1].y;
  }
  return out;
}

// Buffer zone: guarantee the segment touching each endpoint runs PERPENDICULAR
// to that node's side for at least `buf` before the line may turn — so the
// arrow always points straight into the node and never skims along its edge.
// Idempotent: a route that already exits cleanly (autoOrtho / obstacle routes)
// is left untouched; only one that would leave/enter parallel (e.g. a bend
// dragged alongside the node, or a re-based route) gets a stub inserted.
function enforceStubs(pts, sPos, tPos, buf = STUB) {
  if (!pts || pts.length < 2) return pts;
  let out = pts.map((p) => ({ ...p }));
  out = stubLead(out, sPos, buf);
  out.reverse();
  out = stubLead(out, tPos, buf);
  out.reverse();
  return out;
}

// Ensure out[0]→out[1] leaves out[0] along the side's outward normal for ≥ buf,
// inserting an orthogonal stub (+ jog) when it doesn't.
function stubLead(out, side, buf) {
  if (out.length < 2) return out;
  const n = sideNormal(side);
  const A = out[0], B = out[1];
  const horiz = n.x !== 0;                                  // stub runs along x
  const onNormal = horiz ? Math.abs(B.y - A.y) < 0.5 : Math.abs(B.x - A.x) < 0.5;
  const farEnough = horiz ? (B.x - A.x) * n.x >= buf - 0.5 : (B.y - A.y) * n.y >= buf - 0.5;
  if (onNormal && farEnough) return out;                    // already a clean perpendicular stub
  const stub = { x: A.x + n.x * buf, y: A.y + n.y * buf };  // forced perpendicular point
  const jog = horiz ? { x: stub.x, y: B.y } : { x: B.x, y: stub.y };
  const insert = [stub];
  if (Math.abs(jog.x - stub.x) > 0.5 || Math.abs(jog.y - stub.y) > 0.5) insert.push(jog);
  return [A, ...insert, ...out.slice(1)];
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

// Cap kind → the custom marker url (or none). Used for BOTH ends.
function capUrl(kind) {
  switch (kind) {
    case "arrow": return "url(#wb-arrow)";
    case "open": return "url(#wb-open)";
    case "dot": return "url(#wb-dot)";
    case "diamond": return "url(#wb-diamond)";
    default: return undefined; // "none"
  }
}

// Mini edge preview for the cap pickers — a short line with the cap on the given
// end, so you can see the shape AND tell start from finish at a glance. Reuses
// the shared markers; currentColor drives context-stroke to match the toolbar.
function CapPreview({ cap, end }) {
  const url = capUrl(cap);
  const m = end === "start" ? { markerStart: url } : { markerEnd: url };
  // Explicit light stroke (NOT currentColor): the markers colour themselves via
  // context-stroke, which passes the referencing line's stroke VALUE — a
  // "currentColor" keyword would resolve to black inside the marker, so give it
  // a real colour that reads on the dark toolbar.
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden style={{ display: "block", overflow: "visible" }}>
      <line x1="8" y1="7" x2="32" y2="7" stroke="#e2e8f0" strokeWidth="1.6" strokeLinecap="round" {...m} />
    </svg>
  );
}

function EdgeToolbar({ x, y, style, data, patchEdge, onEditLabel }) {
  const [open, setOpen] = useState(null);
  const color = style?.stroke || "#0ea5e9";
  const width = style?.strokeWidth || 2;
  const dash = style?.strokeDasharray || "";
  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  const endCap = data?.endCap || "arrow";
  const startCap = data?.startCap || "none";
  const setStyle = (p) => patchEdge({ style: { ...style, ...p } });
  const opt = (active, onClick, label) => (
    <button key={label} type="button" onClick={() => { onClick(); setOpen(null); }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}>
      {label}
    </button>
  );
  // Cap option with a live mini-preview of the cap on the correct end.
  const capOpt = (active, onClick, label, cap, end) => (
    <button key={label} type="button" onClick={() => { onClick(); setOpen(null); }}
      className={`flex items-center gap-2.5 w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}>
      <span className="w-10 shrink-0 flex items-center"><CapPreview cap={cap} end={end} /></span>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="nodrag nopan" style={{ position: "absolute", transform: `translate(-50%,-100%) translate(${x}px,${y - 18}px)`, pointerEvents: "all", zIndex: 50 }}>
      <Pill>
        <Dropdown openKey="color" open={open} setOpen={setOpen} icon={<span className="w-4 h-4 rounded-full border border-white/30" style={{ background: color }} />}>
          <SwatchGrid value={color} onPick={(c) => patchEdge({ style: { ...style, stroke: c } })} />
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
        <Dropdown openKey="capStart" open={open} setOpen={setOpen} title="Start-end cap" icon={<CapPreview cap={startCap} end="start" />}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/40 px-2 pt-1 pb-0.5">Start end</div>
          {EDGE_CAPS.map(([l, k]) => capOpt(startCap === k, () => patchEdge({ data: { ...data, startCap: k } }), l, k, "start"))}
        </Dropdown>
        <Dropdown openKey="cap" open={open} setOpen={setOpen} title="Finish-end cap" icon={<CapPreview cap={endCap} end="finish" />}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/40 px-2 pt-1 pb-0.5">Finish end</div>
          {EDGE_CAPS.map(([l, k]) => capOpt(endCap === k, () => patchEdge({ data: { ...data, endCap: k } }), l, k, "finish"))}
        </Dropdown>
        <ToolDivider />
        <button type="button" title="Tidy — auto-route around nodes"
          onClick={() => patchEdge({ data: { ...data, autoRoute: true, route: undefined, routeFrame: undefined } })}
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
// Auto ("floating") anchor: the perimeter point of `rect` facing `toward`
// (the other node's centre) + its side. So an edge leaves from the side
// pointing at its partner and re-picks live as nodes move; the A* route then
// steers the line around any nodes in between. (React Flow floating-edge math.)
function floatingAnchor(rect, toward) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  // Pick the side facing the other node, then attach at that side's CENTRE.
  // Auto edges snap to side midpoints (clean, FigJam-like); only a manual
  // endpoint drag (explicit anchor) overrides this to sit elsewhere on a side.
  const horizontal = Math.abs(dx) * rect.h >= Math.abs(dy) * rect.w;
  if (horizontal) {
    return dx >= 0
      ? { x: rect.x + rect.w, y: cy, pos: "right" }
      : { x: rect.x, y: cy, pos: "left" };
  }
  return dy >= 0
    ? { x: cx, y: rect.y + rect.h, pos: "bottom" }
    : { x: cx, y: rect.y, pos: "top" };
}

// Pick BOTH floating sides together for the fewest corners: nodes that share
// an x- or y-range connect straight (top/bottom or left/right); diagonal nodes
// form a single-corner L — source exits on the dominant axis, target enters on
// the other — instead of the 2-corner Z you get choosing each side alone.
export function floatingPair(sRect, tRect) {
  const dx = (tRect.x + tRect.w / 2) - (sRect.x + sRect.w / 2);
  const dy = (tRect.y + tRect.h / 2) - (sRect.y + sRect.h / 2);
  const overlapX = Math.min(sRect.x + sRect.w, tRect.x + tRect.w) - Math.max(sRect.x, tRect.x) > 1;
  const overlapY = Math.min(sRect.y + sRect.h, tRect.y + tRect.h) - Math.max(sRect.y, tRect.y) > 1;
  if (overlapX && !overlapY) return { sSide: dy > 0 ? "bottom" : "top", tSide: dy > 0 ? "top" : "bottom" };
  if (overlapY && !overlapX) return { sSide: dx > 0 ? "right" : "left", tSide: dx > 0 ? "left" : "right" };
  if (Math.abs(dx) >= Math.abs(dy)) return { sSide: dx > 0 ? "right" : "left", tSide: dy > 0 ? "top" : "bottom" };
  return { sSide: dy > 0 ? "bottom" : "top", tSide: dx > 0 ? "left" : "right" };
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

// Loose snap for a hand-dragged endpoint: pull its position along the side
// toward the tidy points — corners, quarters, midpoint — when within ~12 flow
// px (as a fraction of the side length), else leave it free.
const ANCHOR_TS = [0, 0.25, 0.5, 0.75, 1];
function snapAnchorT(t, sideLen) {
  const thresh = 12 / Math.max(1, sideLen);
  let best = t, bestD = thresh, snapped = false;
  for (const s of ANCHOR_TS) {
    const d = Math.abs(t - s);
    if (d < bestD) { bestD = d; best = s; snapped = true; }
  }
  return { t: best, snapped };
}

// When ONE end is pinned to a side, the OTHER (floating) end takes the side of
// `floatRect` that FACES the pinned end along the dominant axis. It always
// enters from its NEAR side, so the route never wraps around to the far side —
// the source keeps the side you pinned, the far end just receives it cleanly.
// (`pinnedSide` is kept in the signature for callers but isn't needed: the
// facing side depends only on where the two nodes sit.)
export function complementSide(pinnedSide, pinnedRect, floatRect) {
  const dx = (floatRect.x + floatRect.w / 2) - (pinnedRect.x + pinnedRect.w / 2);
  const dy = (floatRect.y + floatRect.h / 2) - (pinnedRect.y + pinnedRect.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "left" : "right";
  return dy > 0 ? "top" : "bottom";
}

// projectToPerimeter + loose corner/quarter/mid snap, flagged `auto` when it
// actually snapped. Shared by hand-dragged endpoints and new connections so
// they snap the same way.
export function snappedAnchor(rect, px, py) {
  if (!rect) return null;
  const a = projectToPerimeter(rect, px, py);
  const sideLen = a.side === "top" || a.side === "bottom" ? rect.w : rect.h;
  const snap = snapAnchorT(a.t, sideLen);
  return { side: a.side, t: snap.t, auto: snap.snapped };
}

// Editable edge: an orthogonal route whose straight segments you drag
// (rectangle handles) to reshape — FigJam-style. Double-click anywhere on
// the line to drop a label there. Endpoints can be dragged to any spot
// around the connected node's perimeter.
const EditableEdge = memo(function EditableEdge({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, data, selected,
}) {
  const { setEdges, screenToFlowPosition, getNode, getNodes } = useReactFlow();
  // End-caps come from data (both ends independently). Default: a target arrow,
  // no source cap. Custom markers → reliable dot/diamond + start-end support.
  const markerStart = capUrl(data?.startCap ?? "none");
  const markerEnd = capUrl(data?.endCap ?? "arrow");

  // Endpoint resolution, recomputed live from the node rects so a dragged
  // node's edges re-anchor in real time:
  //   1. a user-dragged anchor (data.sourceAnchor/targetAnchor) wins — fixed.
  //   2. otherwise FLOAT to the side facing the other node's centre, so the
  //      edge always leaves from the near side and re-picks as nodes move.
  //   3. xyflow's connected handle only as a fallback before nodes measure.
  const sRect = nodeRect(source ? getNode(source) : null);
  const tRect = nodeRect(target ? getNode(target) : null);
  const sCenter = sRect && { x: sRect.x + sRect.w / 2, y: sRect.y + sRect.h / 2 };
  const tCenter = tRect && { x: tRect.x + tRect.w / 2, y: tRect.y + tRect.h / 2 };
  // Decide each end's SIDE — the balance of "smart" and "what you asked for":
  //  • A PINNED anchor (data.sourceAnchor/targetAnchor — you pulled the edge
  //    from that side, or dragged the endpoint onto it) is honoured EXACTLY,
  //    on ANY side incl. the far/away side, so you can wrap an edge around to
  //    the OPPOSITE ends of two nodes. It never auto-flips.
  //  • A FLOATING end (no anchor) picks the cleanest side facing its partner,
  //    re-aiming as nodes move (auto-repair of away-facing wraps). Both
  //    floating → joint pick for the fewest corners; one pinned → the floating
  //    end faces the pinned one (complementSide), so it receives the edge on
  //    its near side without wrapping.
  const sAnc = data?.sourceAnchor, tAnc = data?.targetAnchor;
  let sSide = sAnc?.side ?? null, tSide = tAnc?.side ?? null;
  if (sRect && tRect) {
    if (!sAnc && !tAnc) { const p = floatingPair(sRect, tRect); sSide = p.sSide; tSide = p.tSide; }
    else if (!sAnc) sSide = complementSide(tSide, tRect, sRect);
    else if (!tAnc) tSide = complementSide(sSide, sRect, tRect);
  } else {
    if (!sSide && sRect && tCenter) sSide = floatingAnchor(sRect, tCenter).pos;
    if (!tSide && tRect && sCenter) tSide = floatingAnchor(tRect, sCenter).pos;
  }
  const sa = sRect && sSide ? anchorPoint(sRect, { side: sSide, t: sAnc?.t ?? 0.5 }) : null;
  const ta = tRect && tSide ? anchorPoint(tRect, { side: tSide, t: tAnc?.t ?? 0.5 }) : null;
  let sX = sa ? sa.x : sourceX, sY = sa ? sa.y : sourceY;
  let tX = ta ? ta.x : targetX, tY = ta ? ta.y : targetY;
  const sPos = sa ? sa.pos : sourcePosition;
  const tPos = ta ? ta.pos : targetPosition;
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  // True only when EXACTLY one element (this edge) is selected — so a marquee
  // multi-select doesn't stack a toolbar + handles on every caught edge.
  const sole = useStore((s) => {
    let n = 0;
    for (const nd of s.nodes) if (nd.selected) { if (++n > 1) return false; }
    for (const ed of s.edges) if (ed.selected) { if (++n > 1) return false; }
    return n === 1;
  });
  const soleSelected = selected && sole;
  const [dragEnd, setDragEnd] = useState(null); // free cursor pos while re-aiming an endpoint
  const [snapHint, setSnapHint] = useState(null); // { rect, side, t, snapped } target node's snap points while re-aiming
  const [draft, setDraft] = useState(data?.label || "");
  // While re-aiming an endpoint over empty space, that end follows the cursor
  // (rubber-band) so it stays visible and you can drop it on another node —
  // instead of snapping back onto the source node's nearest side.
  if (dragEnd?.which === "source") { sX = dragEnd.x; sY = dragEnd.y; }
  if (dragEnd?.which === "target") { tX = dragEnd.x; tY = dragEnd.y; }
  const inputRef = useRef(null);
  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  // Obstacle-avoiding route, computed LIVE in render so a dragged node's
  // edges re-flow in real time (no debounce, no snap-after-settle). The A*
  // is cheap (routing.js) and — thanks to memo() — only edges whose OWN
  // endpoints move re-render, so per-frame cost is bounded to the dragged
  // node's edges. Only pinned (manually reshaped) edges skip it — every auto
  // style (elbow, curve, smooth) routes around obstacles; curves just render
  // the same waypoints with a larger corner radius.
  // Nothing is written to data here, so there's no save/sync churn while
  // dragging; peers recompute the same route from synced node positions.
  // A hand-shaped route (autoRoute:false) is honoured only while the edge still
  // leaves the SAME sides it did when you shaped it — captured in routeFrame.
  // If a (floating) endpoint has since re-aimed to another side because its
  // node crossed over, the shape no longer fits how the edge now meets the node
  // → we drop back to auto-routing. Pinned endpoints never change side, so
  // their shapes are always kept. Legacy routes (no frame) stay pinned as before.
  const frame = data?.routeFrame;
  const sidesKept = !frame || (frame.sPos === sPos && frame.tPos === tPos);
  const manual = data?.autoRoute === false && data?.route?.length > 0 && sidesKept;
  const obstacleRoute = useMemo(() => {
    if (manual) return null;
    // Does either end leave from a side pointing AWAY from its partner? Then
    // the line has to wrap around its OWN node, so we must run the router even
    // with no other obstacles — otherwise the naive elbow draws a line
    // straight THROUGH the nodes. This is what makes opposite-ends connections
    // (outer side → outer side) route cleanly up and over.
    const sR = nodeRect(getNode(source)), tR = nodeRect(getNode(target));
    let wraps = false;
    if (sR && tR) {
      const sC = { x: sR.x + sR.w / 2, y: sR.y + sR.h / 2 };
      const tC = { x: tR.x + tR.w / 2, y: tR.y + tR.h / 2 };
      const sn = sideNormal(sPos), tn = sideNormal(tPos);
      const sAway = sn.x * (tC.x - sX) + sn.y * (tC.y - sY) < -1;
      const tAway = tn.x * (sC.x - tX) + tn.y * (sC.y - tY) < -1;
      wraps = sAway || tAway;
    }
    // Collect OTHER nodes only. If there's nothing else in the way AND neither
    // end wraps, skip A* and fall back to the simple elbow — fewest corners.
    const others = [];
    for (const n of getNodes()) {
      if (n.type === "zone" || n.type === "frame" || n.id === source || n.id === target) continue;
      const r = nodeRect(n);
      if (r) others.push(r);
    }
    if (!others.length && !wraps) return null;
    // Route → A*. Add our own source/target so the line bends around them
    // rather than cutting across (the 22px stub > 16px margin keeps the
    // start/goal valid). Curves get extra clearance for their bow.
    const obstacles = others;
    for (const nid of [source, target]) { const r = nodeRect(getNode(nid)); if (r) obstacles.push(r); }
    const isCurve = (data?.routing || "elbow") === "curve";
    const margin = isCurve ? MARGIN + Math.min(data?.curviness ?? 18, 30) : MARGIN;
    return routeAround({ x: sX, y: sY }, sideNormal(sPos), { x: tX, y: tY }, sideNormal(tPos), obstacles, margin);
  }, [manual, data?.routing, data?.curviness, source, target, sX, sY, sPos, tX, tY, tPos, getNode, getNodes]);

  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  // Manual → the hand-shaped route, RE-BASED relative to the current endpoints
  // so it keeps its shape as nodes move; auto → the live obstacle route; else
  // the simple elbow.
  const interior = manual
    ? rebaseRoute(data.route, frame, { x: sX, y: sY }, { x: tX, y: tY })
    : (obstacleRoute && obstacleRoute.length ? obstacleRoute : autoOrtho(sX, sY, sPos, tX, tY, tPos));
  const rawFull = [{ x: sX, y: sY }, ...interior, { x: tX, y: tY }];
  // Elbows are squared off — every segment forced horizontal/vertical, even
  // after a node moves and a stub goes stale — then we enforce the perpendicular
  // buffer zone at both ends so the arrow always points into the node. Curves
  // keep their diagonals.
  const full = routing === "curve" ? rawFull : enforceStubs(orthogonalize(rawFull), sPos, tPos);
  // The polyline currently on screen — used by the segment/delete handlers
  // so a grabbed handle maps to the route the user actually sees.
  const fullRef = useRef(full);
  fullRef.current = full;
  // Live endpoint frame, captured when a route is pinned so it can be re-based.
  const endRef = useRef();
  endRef.current = { sx: sX, sy: sY, tx: tX, ty: tY, sPos, tPos };
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
    // Snapshot the endpoint frame so the saved bends can be RE-BASED relative
    // to the nodes (keeps the shape as they move).
    const e0 = endRef.current;
    const routeFrame = { sx: e0.sx, sy: e0.sy, tx: e0.tx, ty: e0.ty, sPos: e0.sPos, tPos: e0.tPos };
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const pts = base.map((pt) => ({ ...pt }));
      // Snap the dragged bend to the grid so edge corners line up with nodes.
      if (horiz) { const y = snapToGrid(p.y); pts[fullIndex].y = y; pts[fullIndex + 1].y = y; }
      else { const x = snapToGrid(p.x); pts[fullIndex].x = x; pts[fullIndex + 1].x = x; }
      setEdges((eds) => eds.map((edge) => (
        edge.id === id ? { ...edge, data: { ...edge.data, route: pts.slice(1, -1), routeFrame, autoRoute: false } } : edge
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
    const e0 = endRef.current;
    const routeFrame = { sx: e0.sx, sy: e0.sy, tx: e0.tx, ty: e0.ty, sPos: e0.sPos, tPos: e0.tPos };
    // Deleting a section is a manual edit → pin so the auto-router doesn't
    // immediately restore the removed bend.
    setEdges((eds) => eds.map((edge) => (
      edge.id === id ? { ...edge, data: { ...edge.data, route: nextInterior.length ? nextInterior : undefined, ...(nextInterior.length ? { routeFrame } : { routeFrame: undefined }), autoRoute: false } } : edge
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
      // Node under the cursor → the re-attach target (only connectable nodes).
      let hit = null;
      for (const n of getNodes()) {
        if (NON_CONNECTABLE.has(n.type)) continue;
        const r = nodeRect(n);
        if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { hit = n; break; }
      }
      if (!hit) {
        // Over empty space → let the end float at the cursor (visible, re-
        // aimable). Don't touch the attachment yet; releasing here keeps it.
        setDragEnd({ which, x: p.x, y: p.y });
        setSnapHint(null);
        return;
      }
      // Over a node → attach there, loosely snapped to the side's tidy points
      // (a snapped/centred end is flagged `auto` so it re-floats as nodes move).
      setDragEnd(null);
      const hitRect = nodeRect(hit);
      const anchor = snappedAnchor(hitRect, p.x, p.y);
      setSnapHint({ rect: hitRect, side: anchor.side, t: anchor.t, snapped: anchor.auto });
      setEdges((eds) => eds.map((edge) => {
        if (edge.id !== id) return edge;
        const next = { ...edge, data: { ...edge.data, [key]: anchor, route: undefined, routeFrame: undefined } };
        if (edge[endKey] !== hit.id) next[endKey] = hit.id; // re-attach
        return next;
      }));
    };
    const onUp = () => { setDragEnd(null); setSnapHint(null); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [id, getNodes, screenToFlowPosition, setEdges]);

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
        {soleSelected && (
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

        {soleSelected && segHandles.map((h) => (
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
        {(soleSelected || hovered) && [
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

        {/* Snap-point hints on the node you're re-aiming an endpoint at —
            corners, quarters, midpoint of the facing side; the active one is
            filled so you can see exactly where it'll land. */}
        {snapHint && [0, 0.25, 0.5, 0.75, 1].map((t) => {
          const dp = anchorPoint(snapHint.rect, { side: snapHint.side, t });
          if (!dp) return null;
          const active = snapHint.snapped && Math.abs(t - snapHint.t) < 0.01;
          return (
            <div key={`snap-${t}`} className="nodrag nopan" style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${dp.x}px,${dp.y}px)`,
              pointerEvents: "none", zIndex: 8,
              width: active ? 12 : 8, height: active ? 12 : 8, borderRadius: 9999,
              background: active ? color : "#fff",
              border: `2px solid ${color}`,
              boxShadow: "0 1px 3px rgba(0,0,0,.35)",
            }} />
          );
        })}
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
// Every tidy attach point around a node's perimeter (corners, quarters,
// midpoints), de-duped — drawn as the options while you aim a connection at it.
function perimeterSnapPoints(rect) {
  const seen = new Set(); const out = [];
  for (const side of ["top", "right", "bottom", "left"]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = anchorPoint(rect, { side, t });
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(key)) continue; seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, fromNode }) {
  const { getNodes } = useReactFlow();
  const pickedShape = useContext(ConnectShapeContext);
  const fp = fromPosition || "right";
  const sRect = nodeRect(fromNode);

  // Cursor over an existing (connectable) node?
  let over = null;
  for (const n of getNodes()) {
    if (NON_CONNECTABLE.has(n.type)) continue;
    if (fromNode && n.id === fromNode.id) continue;
    const r = nodeRect(n);
    if (r && toX >= r.x && toX <= r.x + r.w && toY >= r.y && toY <= r.y + r.h) { over = r; break; }
  }

  if (over) {
    // Connecting to an existing node: the source leaves from the side you
    // pulled from; the target attaches at the perimeter point NEAREST the
    // cursor. Show ALL the snap-point options so you can pick where it lands —
    // the nearest one is highlighted and is where the drop will attach.
    const sp = sRect ? anchorPoint(sRect, { side: fp, t: 0.5 }) : { x: fromX, y: fromY, pos: fp };
    const tp = anchorPoint(over, snappedAnchor(over, toX, toY));
    const interior = autoOrtho(sp.x, sp.y, sp.pos, tp.x, tp.y, tp.pos);
    const d = roundedPath(orthogonalize([{ x: sp.x, y: sp.y }, ...interior, { x: tp.x, y: tp.y }]), 12);
    return (
      <g>
        <path fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d={d} />
        <circle cx={sp.x} cy={sp.y} r={3.5} fill="#22c55e" />
        {perimeterSnapPoints(over).map((p, i) => {
          const active = Math.abs(p.x - tp.x) < 0.5 && Math.abs(p.y - tp.y) < 0.5;
          return <circle key={i} cx={p.x} cy={p.y} r={active ? 5.5 : 3}
            fill={active ? "#22c55e" : "#fff"} stroke="#22c55e" strokeWidth={active ? 2.5 : 1.75} />;
        })}
      </g>
    );
  }

  // Over empty canvas → ghost of the node a drop would create. A drop here PINS
  // the source to the side you pulled from and lets the ghost float facing it,
  // so preview exactly that against a grid-snapped ghost.
  const accent = "#64748b";
  const sw = fromNode?.measured?.width ?? fromNode?.width ?? 150;
  const sh = fromNode?.measured?.height ?? fromNode?.height ?? 90;
  const center = sRect ? { x: sRect.x + sw / 2, y: sRect.y + sh / 2 } : { x: fromX, y: fromY };
  const place = connectedNodePlacement(center, toX, toY, { w: sw, h: sh });
  const gx = snapToGrid(place.x), gy = snapToGrid(place.y);
  const ghostRect = { x: gx, y: gy, w: sw, h: sh };
  // The ghost draws the ACTUAL shape a drop would create — the number-picked
  // shape if any, else the parent's (so it mirrors) — instead of a plain box.
  const isShapeParent = ["shape", "rect", "ellipse", "diamond"].includes(fromNode?.type);
  const ghostShape = pickedShape || (isShapeParent ? (fromNode?.data?.shape || LEGACY_GHOST[fromNode?.type] || "process") : "process");
  const sp = sRect ? anchorPoint(sRect, { side: fp, t: 0.5 }) : { x: fromX, y: fromY, pos: fp };
  const tSide = sRect ? complementSide(fp, sRect, ghostRect) : SIDE_POS[place.side];
  const tp = anchorPoint(ghostRect, { side: tSide, t: 0.5 });
  const interior = autoOrtho(sp.x, sp.y, sp.pos, tp.x, tp.y, tp.pos);
  const d = roundedPath(orthogonalize([{ x: sp.x, y: sp.y }, ...interior, { x: tp.x, y: tp.y }]), 12);
  return (
    <g>
      <path fill="none" stroke={accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d={d} />
      <circle cx={sp.x} cy={sp.y} r={3.5} fill={accent} />
      <g transform={`translate(${gx},${gy})`} opacity={0.75}>
        <ShapeSvg shape={ghostShape} w={sw} h={sh} fill="rgba(100,116,139,.06)" stroke={accent} sw={1.5} dash="6 5" />
      </g>
      <g transform={`translate(${tp.x},${tp.y})`}>
        <circle r={9} fill="#fff" stroke={accent} strokeWidth={2.5} />
        <path d="M-4 0 H4 M0 -4 V4" stroke={accent} strokeWidth={2} strokeLinecap="round" />
      </g>
    </g>
  );
}

export const EDGE_TYPES = { editable: EditableEdge };
