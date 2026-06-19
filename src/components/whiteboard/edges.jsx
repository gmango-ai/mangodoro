import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, MarkerType, useReactFlow } from "@xyflow/react";
import { ChevronDown, Type, Minus, Spline, MoveRight, AlignJustify } from "lucide-react";

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

const EDGE_SWATCHES = ["#0ea5e9", "#0f172a", "#ef4444", "#f97316", "#22c55e", "#8b5cf6", "#64748b", "#ffffff"];
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

function Dropdown({ openKey, open, setOpen, icon, children }) {
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(open === openKey ? null : openKey)}
        className="h-7 px-1 rounded-md flex items-center gap-0.5 text-white/90 hover:bg-white/10"
        style={{ background: open === openKey ? "rgba(255,255,255,.14)" : "transparent" }}>
        {icon}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open === openKey && (
        <div className="absolute top-8 left-0 z-30 rounded-lg shadow-2xl p-1 min-w-[96px]" style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.1)" }}>
          {children}
        </div>
      )}
    </div>
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
  const setStyle = (p) => patchEdge({ style: { ...style, ...p } });
  const opt = (active, onClick, label) => (
    <button key={label} type="button" onClick={() => { onClick(); setOpen(null); }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}>
      {label}
    </button>
  );
  return (
    <div className="nodrag nopan" style={{ position: "absolute", transform: `translate(-50%,-100%) translate(${x}px,${y - 18}px)`, pointerEvents: "all" }}>
      <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl shadow-2xl" style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.08)" }}>
        <Dropdown openKey="color" open={open} setOpen={setOpen} icon={<span className="w-4 h-4 rounded-full border border-white/30" style={{ background: color }} />}>
          <div className="grid grid-cols-4 gap-1 p-1">
            {EDGE_SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => { patchEdge({ style: { ...style, stroke: c }, ...(endCap !== "none" ? { markerEnd: capMarker(endCap, c) } : {}) }); setOpen(null); }}
                className="w-5 h-5 rounded-full border border-white/20" style={{ background: c, outline: color === c ? "2px solid #fff" : "none" }} />
            ))}
          </div>
        </Dropdown>
        <Dropdown openKey="weight" open={open} setOpen={setOpen} icon={<AlignJustify className="w-4 h-4" />}>
          {WEIGHTS.map(([l, v]) => opt(width === v, () => setStyle({ strokeWidth: v }), l))}
        </Dropdown>
        <button type="button" onClick={() => { onEditLabel(); setOpen(null); }} title="Add text" className="h-7 w-7 rounded-md flex items-center justify-center text-white/90 hover:bg-white/10">
          <Type className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-white/10 mx-0.5" />
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
      </div>
    </div>
  );
}

// Editable edge: an orthogonal route whose straight segments you drag
// (rectangle handles) to reshape — FigJam-style. Double-click anywhere on
// the line to drop a label there.
const EditableEdge = memo(function EditableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  markerStart, markerEnd, style, data, selected,
}) {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data?.label || "");
  const inputRef = useRef(null);
  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  const stored = data?.route;
  const interior = (stored && stored.length)
    ? stored
    : autoOrtho(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition);
  const full = [{ x: sourceX, y: sourceY }, ...interior, { x: targetX, y: targetY }];
  const path = roundedPath(full, routing === "curve" ? Math.min(curviness, 30) : 8);
  const labelPt = pointAtT(path, data?.labelT ?? 0.5) || { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  const label = data?.label || "";
  const color = style?.stroke || "#0ea5e9";

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

  // Drag a straight segment perpendicular; its two corner endpoints move
  // together, so the route stays orthogonal and the neighbours stretch.
  const dragSeg = useCallback((fullIndex, horiz, e) => {
    e.stopPropagation();
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      setEdges((eds) => eds.map((edge) => {
        if (edge.id !== id) return edge;
        const itr = (edge.data?.route && edge.data.route.length
          ? edge.data.route
          : autoOrtho(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition)
        ).map((pt) => ({ ...pt }));
        const ai = fullIndex - 1, bi = fullIndex; // interior indices of the segment ends
        if (!itr[ai] || !itr[bi]) return edge;
        if (horiz) { itr[ai].y = p.y; itr[bi].y = p.y; }
        else { itr[ai].x = p.x; itr[bi].x = p.x; }
        return { ...edge, data: { ...edge.data, route: itr } };
      }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, screenToFlowPosition, setEdges]);

  const onEdgeDblClick = useCallback((e) => {
    e.stopPropagation();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    patchData({ labelT: nearestT(path, p.x, p.y) });
    setEditing(true);
  }, [path, screenToFlowPosition, patchData]);

  // Draggable interior segments (exclude the two perpendicular stubs).
  const segHandles = [];
  for (let i = 1; i <= full.length - 3; i++) {
    const a = full[i], b = full[i + 1];
    segHandles.push({ i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horiz: Math.abs(a.y - b.y) < 0.5 });
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      {/* Wide invisible hit-path: double-click anywhere to label. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={22} style={{ cursor: "text" }} onDoubleClick={onEdgeDblClick} />
      <EdgeLabelRenderer>
        {selected && (
          <EdgeToolbar x={labelPt.x} y={labelPt.y} style={style} data={data} patchEdge={patchEdge} onEditLabel={() => setEditing(true)} />
        )}

        {(editing || label) && (
          <div className="nodrag nopan"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y}px)`, pointerEvents: "all", cursor: editing ? "text" : "pointer" }}
            onDoubleClick={() => setEditing(true)}>
            {editing ? (
              <input ref={inputRef} value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 80))}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { setDraft(label); setEditing(false); } }}
                placeholder="Add text"
                className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 outline-none text-white placeholder-white/70"
                style={{ background: color, width: Math.max(60, draft.length * 7 + 24) }} />
            ) : (
              <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 text-white" style={{ background: color }}>{label}</span>
            )}
          </div>
        )}

        {selected && segHandles.map((h) => (
          <div key={`seg-${h.i}`} className="nodrag nopan"
            onPointerDown={(e) => dragSeg(h.i, h.horiz, e)}
            title="Drag to move this segment"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${h.x}px,${h.y}px)`,
              pointerEvents: "all",
              width: h.horiz ? 22 : 9, height: h.horiz ? 9 : 22, borderRadius: 4,
              background: color, border: "2px solid #fff",
              cursor: h.horiz ? "ns-resize" : "ew-resize",
              boxShadow: "0 1px 4px rgba(0,0,0,.4)",
            }} />
        ))}
        {selected && [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }].map((pt, i) => (
          <div key={`ep-${i}`} className="nodrag nopan" style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${pt.x}px,${pt.y}px)`, pointerEvents: "none", width: 11, height: 11, borderRadius: 9999, background: "#fff", border: `2px solid ${color}`, boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
        ))}
      </EdgeLabelRenderer>
    </>
  );
});

// Ghost preview while dragging a new connection onto empty canvas.
export function ConnectionLine({ fromX, fromY, toX, toY }) {
  const W = 180, H = 100;
  const dx = toX - fromX, dy = toY - fromY;
  let gx, gy;
  if (Math.abs(dx) > Math.abs(dy)) { gx = dx > 0 ? toX : toX - W; gy = toY - H / 2; }
  else { gy = dy > 0 ? toY : toY - H; gx = toX - W / 2; }
  return (
    <g>
      <path fill="none" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 3" d={`M${fromX},${fromY} L${toX},${toY}`} />
      <rect x={gx} y={gy} width={W} height={H} rx={10} fill="rgba(14,165,233,.08)" stroke="#0ea5e9" strokeWidth={1.5} strokeDasharray="5 4" />
      <circle cx={toX} cy={toY} r={3.5} fill="#0ea5e9" />
    </g>
  );
}

export const EDGE_TYPES = { editable: EditableEdge };
