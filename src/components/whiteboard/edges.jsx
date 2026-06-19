import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, MarkerType, useReactFlow,
} from "@xyflow/react";
import { ChevronDown, Type, Minus, Spline, MoveRight, AlignJustify } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

// Point at fraction t (0..1) along an SVG path string — used to lock the
// edge label to the line while still letting it slide anywhere along it.
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

// ─── Contextual edge toolbar (FigJam/Lucidchart style) ────────────

const EDGE_SWATCHES = ["#0ea5e9", "#0f172a", "#ef4444", "#f97316", "#22c55e", "#8b5cf6", "#64748b", "#ffffff"];
const WEIGHTS = [["Thin", 1.5], ["Medium", 2], ["Thick", 3.5]];
const LINES = [["Solid", ""], ["Dashed", "6 4"], ["Dotted", "1.5 5"]];
const ROUTES = [["Straight", "straight"], ["Elbow", "smooth"], ["Curved", "curved"]];
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
        <div
          className="absolute top-8 left-0 z-30 rounded-lg shadow-2xl p-1 min-w-[96px]"
          style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.1)" }}
        >
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
  const routing = data?.routing || "smooth";
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
    <div
      className="nodrag nopan"
      style={{ position: "absolute", transform: `translate(-50%,-100%) translate(${x}px,${y - 18}px)`, pointerEvents: "all" }}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl shadow-2xl"
        style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.08)" }}
      >
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
          {ROUTES.map(([l, k]) => opt(routing === k, () => patchEdge({ data: { ...data, routing: k } }), l))}
        </Dropdown>
        <Dropdown openKey="cap" open={open} setOpen={setOpen} icon={<MoveRight className="w-4 h-4" />}>
          {EDGE_CAPS.map(([l, k]) => opt(endCap === k, () => patchEdge({ markerEnd: capMarker(k, color), data: { ...data, endCap: k } }), l))}
        </Dropdown>
      </div>
    </div>
  );
}

// Editable edge: routing control + a draggable, restyle-able label.
//
// Elbow routing (default) stays orthogonal and exposes a drag handle at
// its bend — push/pull it to route around nodes; segments re-flow and
// stay square. Double-click the handle to snap back to auto.
//
// The label matches the edge colour, can be dragged anywhere along (or
// off) the path, and comes in two looks: a filled "pill" or a "text"
// style that masks the line behind the words (no pill).
const EditableEdge = memo(function EditableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerStart, markerEnd, style, data, selected,
}) {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data?.label || "");
  const inputRef = useRef(null);
  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const routing = data?.routing || "smooth";
  const hasCenter = data?.centerX != null && data?.centerY != null;
  let path, labelX, labelY;
  if (routing === "straight") {
    [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else if (routing === "curved") {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12,
      ...(hasCenter ? { centerX: data.centerX, centerY: data.centerY } : {}),
    });
  }

  const label = data?.label || "";
  const color = style?.stroke || "#0ea5e9";
  const isMask = (data?.labelStyle || "pill") === "mask";
  const canvasBg = dark ? "#0f172a" : "#fbf6ee";

  const patchData = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
  }, [id, setEdges]);
  const patchEdge = useCallback((patch) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, [id, setEdges]);
  const commit = useCallback(() => { patchData({ label: draft.trim() }); setEditing(false); }, [patchData, draft]);

  const dragElbow = useCallback((e) => {
    e.stopPropagation();
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      patchData({ centerX: p.x, centerY: p.y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [patchData, screenToFlowPosition]);

  // Drag the label, LOCKED to the path: project the cursor onto the edge
  // and store the nearest length-fraction (0..1), so it slides along the
  // line and never floats off it.
  const dragLabel = useCallback((e) => {
    e.stopPropagation();
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", path);
    let len = 0;
    try { len = el.getTotalLength(); } catch { /* */ }
    if (!len) return;
    const N = 100;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const pt = el.getPointAtLength((i / N) * len);
      samples.push({ t: i / N, x: pt.x, y: pt.y });
    }
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      let best = samples[0], bd = Infinity;
      for (const s of samples) { const dx = s.x - p.x, dy = s.y - p.y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
      patchData({ labelT: best.t });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [path, patchData, screenToFlowPosition]);

  const showElbow = selected && routing === "smooth";
  const showLabel = editing || label || selected;
  // Label rides at length-fraction labelT along the path; defaults to the
  // path centre (lifted off the bend handle when both show).
  const labelPoint = useMemo(() => (data?.labelT != null ? pointAtT(path, data.labelT) : null), [path, data?.labelT]);
  const lx = labelPoint?.x ?? labelX;
  const ly = labelPoint?.y ?? (showElbow ? labelY - 16 : labelY);

  const pillStyle = isMask
    ? { background: canvasBg, color, fontWeight: 700 }
    : { background: color, color: "#fff" };

  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {selected && (
          <EdgeToolbar
            x={labelX}
            y={labelY}
            style={style}
            data={data}
            patchEdge={patchEdge}
            onEditLabel={() => setEditing(true)}
          />
        )}
        {showLabel && (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
              pointerEvents: "all",
              cursor: editing ? "text" : "grab",
            }}
            onPointerDown={editing ? undefined : dragLabel}
            onDoubleClick={() => setEditing(true)}
            title={editing ? undefined : "Drag along the edge · double-click to edit"}
          >
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 80))}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") { setDraft(label); setEditing(false); }
                }}
                placeholder="label"
                className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 outline-none"
                style={{ ...pillStyle, width: Math.max(48, draft.length * 7 + 22) }}
              />
            ) : label ? (
              <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5" style={pillStyle}>{label}</span>
            ) : (
              <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 text-white/95" style={{ background: "rgba(14,165,233,.85)" }}>+ label</span>
            )}
          </div>
        )}
        {showElbow && (
          <div
            className="nodrag nopan"
            onPointerDown={dragElbow}
            onDoubleClick={(e) => { e.stopPropagation(); patchData({ centerX: undefined, centerY: undefined }); }}
            title="Drag to route the edge · double-click to reset"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all", width: 18, height: 8, borderRadius: 9999,
              background: color, border: "2px solid #fff", cursor: "grab",
              boxShadow: "0 1px 4px rgba(0,0,0,.4)",
            }}
          />
        )}
        {selected && [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }].map((pt, i) => (
          <div
            key={`ep-${i}`}
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${pt.x}px,${pt.y}px)`,
              pointerEvents: "none", width: 11, height: 11, borderRadius: 9999,
              background: "#fff", border: `2px solid ${color}`, boxShadow: "0 1px 3px rgba(0,0,0,.3)",
            }}
          />
        ))}
      </EdgeLabelRenderer>
    </>
  );
});

// Ghost preview shown while dragging a new connection off a node onto
// empty canvas: the dashed line plus a phantom of the box that will be
// created, offset so its connecting edge lands at the cursor.
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
