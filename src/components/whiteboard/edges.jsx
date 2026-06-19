import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, MarkerType, useReactFlow } from "@xyflow/react";
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

// Rounded polyline through points. Corner radius r controls the look:
// near-zero = a sharp ELBOW, large = a smooth CURVE. Multiple points →
// a stair.
function roundedPath(points, r = 10) {
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

// Minimum stub: edges leave/enter a node perpendicular to its handle and
// travel this far before any bend — the FigJam "elbows at the joint" feel.
const STUB = 22;
function stubDir(pos) {
  return pos === "left" ? [-1, 0] : pos === "right" ? [1, 0] : pos === "top" ? [0, -1] : [0, 1];
}

// Orthogonal route through points — every segment axis-aligned, so manual
// bends read as clean elbows / stairs. Direction-aware: it alternates the
// turn axis so consecutive bends form a tidy staircase instead of doubling
// back on themselves.
function orthoRoute(points) {
  const out = [points[0]];
  let lastAxis = null; // "h" | "v"
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) {
      out.push(b);
      lastAxis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
    } else {
      const hFirst = lastAxis === "h" ? false : lastAxis === "v" ? true : Math.abs(dx) >= Math.abs(dy);
      if (hFirst) { out.push({ x: b.x, y: a.y }); lastAxis = "v"; }
      else { out.push({ x: a.x, y: b.y }); lastAxis = "h"; }
      out.push(b);
    }
  }
  return out;
}

// Point at fraction t (0..1) along an SVG path — locks the label to the line.
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
      <button
        type="button"
        onClick={() => setOpen(open === openKey ? null : openKey)}
        className="h-7 px-1 rounded-md flex items-center gap-0.5 text-white/90 hover:bg-white/10"
        style={{ background: open === openKey ? "rgba(255,255,255,.14)" : "transparent" }}
      >
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
    <button
      key={label}
      type="button"
      onClick={() => { onClick(); setOpen(null); }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}
    >
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

// Editable edge: elbow / curve routing through draggable bend points (a
// "stair" when you add several), with a contextual toolbar and an inline
// label that only persists when you actually type something.
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

  const routing = data?.routing || "elbow";
  const curviness = data?.curviness ?? 18;
  const waypoints = data?.waypoints || [];
  const hasWp = waypoints.length > 0;
  const pts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }];
  let path, autoX, autoY;
  if (!hasWp) {
    // No manual bends → auto-route cleanly between the two handles
    // (orthogonal elbow / smooth bezier) instead of a straight diagonal.
    if (routing === "curve") {
      [path, autoX, autoY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    } else {
      [path, autoX, autoY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10 });
    }
  } else {
    // Manual bends: leave/enter each node via a perpendicular stub, then
    // route through the waypoints — orthogonal for elbow, smooth for curve.
    const [sdx, sdy] = stubDir(sourcePosition);
    const [tdx, tdy] = stubDir(targetPosition);
    const routePts = [
      { x: sourceX, y: sourceY },
      { x: sourceX + sdx * STUB, y: sourceY + sdy * STUB },
      ...waypoints,
      { x: targetX + tdx * STUB, y: targetY + tdy * STUB },
      { x: targetX, y: targetY },
    ];
    path = routing === "curve"
      ? roundedPath(routePts, Math.min(curviness, 30))
      : roundedPath(orthoRoute(routePts), 8);
  }
  const labelPt = pointAtT(path, data?.labelT ?? 0.5) || { x: autoX ?? (sourceX + targetX) / 2, y: autoY ?? (sourceY + targetY) / 2 };
  // "Pull a bend" capsules — one per base segment, placed ON the path so
  // they're easy to grab. Insertion index = the base segment.
  const numSeg = pts.length - 1;
  const addHandles = [];
  for (let i = 0; i < numSeg; i++) {
    const hp = pointAtT(path, (i + 0.5) / numSeg);
    if (hp) addHandles.push({ seg: i, x: hp.x, y: hp.y });
  }

  const patchData = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
  }, [id, setEdges]);
  const patchEdge = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, [id, setEdges]);

  const label = data?.label || "";
  const color = style?.stroke || "#0ea5e9";
  const showInput = editing || (selected && !label);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  // Persist only when there's real text; otherwise leave the edge unlabelled.
  const commit = useCallback(() => {
    const v = draft.trim();
    patchData({ label: v || undefined });
    setEditing(false);
  }, [draft, patchData]);

  // Drag a bend (existing waypoint) — or, from a segment midpoint, add one
  // and start dragging it (this is how you pull out new elbows / stairs).
  const dragWaypoint = useCallback((index, e) => {
    e.stopPropagation();
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      setEdges((eds) => eds.map((edge) => {
        if (edge.id !== id) return edge;
        const wps = [...(edge.data?.waypoints || [])];
        wps[index] = { x: p.x, y: p.y };
        return { ...edge, data: { ...edge.data, waypoints: wps } };
      }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [id, screenToFlowPosition, setEdges]);

  const addAndDrag = useCallback((segIndex, mid, e) => {
    e.stopPropagation();
    setEdges((eds) => eds.map((edge) => {
      if (edge.id !== id) return edge;
      const wps = [...(edge.data?.waypoints || [])];
      wps.splice(segIndex, 0, mid);
      return { ...edge, data: { ...edge.data, waypoints: wps } };
    }));
    dragWaypoint(segIndex, e);
  }, [id, setEdges, dragWaypoint]);

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
  }, [path, patchData, screenToFlowPosition]);

  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {selected && (
          <EdgeToolbar x={labelPt.x} y={labelPt.y} style={style} data={data} patchEdge={patchEdge} onEditLabel={() => setEditing(true)} />
        )}

        {(showInput || label) && (
          <div
            className="nodrag nopan"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y}px)`, pointerEvents: "all", cursor: showInput ? "text" : "grab" }}
            onPointerDown={showInput ? undefined : dragLabel}
            onDoubleClick={() => setEditing(true)}
          >
            {showInput ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 80))}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { setDraft(label); setEditing(false); } }}
                placeholder="Label"
                className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 outline-none text-white placeholder-white/60"
                style={{ background: color, width: Math.max(54, draft.length * 7 + 24) }}
              />
            ) : (
              <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 text-white" style={{ background: color }} title="Drag to move · double-click to edit">{label}</span>
            )}
          </div>
        )}

        {/* Bend grips — only when selected. Capsules at segment midpoints
            pull out new bends; circles are existing bends (double-click to
            remove). */}
        {selected && addHandles.map((h) => (
          <div
            key={`add-${h.seg}`}
            className="nodrag nopan"
            onPointerDown={(e) => addAndDrag(h.seg, { x: h.x, y: h.y }, e)}
            title="Drag to add a bend"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${h.x}px,${h.y}px)`, pointerEvents: "all", width: 18, height: 8, borderRadius: 9999, background: color, border: "2px solid #fff", cursor: "grab", boxShadow: "0 1px 4px rgba(0,0,0,.4)" }}
          />
        ))}
        {selected && waypoints.map((wp, i) => (
          <div
            key={`wp-${i}`}
            className="nodrag nopan"
            onPointerDown={(e) => dragWaypoint(i, e)}
            onDoubleClick={(e) => { e.stopPropagation(); patchData({ waypoints: waypoints.filter((_, j) => j !== i) }); }}
            title="Drag to bend · double-click to remove"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${wp.x}px,${wp.y}px)`, pointerEvents: "all", width: 12, height: 12, borderRadius: 9999, background: "#fff", border: `2px solid ${color}`, cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}
          />
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
