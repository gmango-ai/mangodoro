import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, useReactFlow,
} from "@xyflow/react";
import { useTheme } from "../../context/ThemeContext";

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
  const commit = useCallback(() => { patchData({ label: draft.trim() }); setEditing(false); }, [patchData, draft]);

  const dragTo = useCallback((key, e) => {
    e.stopPropagation();
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      patchData(key === "label" ? { labelXY: { x: p.x, y: p.y } } : { centerX: p.x, centerY: p.y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [patchData, screenToFlowPosition]);

  const showElbow = selected && routing === "smooth";
  const showLabel = editing || label || selected;
  // Default label sits on the bend (lifted off the handle when both show);
  // once the user drags it, it stays where they put it.
  const lx = data?.labelXY?.x ?? labelX;
  const ly = data?.labelXY?.y ?? (showElbow && !data?.labelXY ? labelY - 16 : labelY);

  const pillStyle = isMask
    ? { background: canvasBg, color, fontWeight: 700 }
    : { background: color, color: "#fff" };

  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {showLabel && (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
              pointerEvents: "all",
              cursor: editing ? "text" : "grab",
            }}
            onPointerDown={editing ? undefined : (e) => dragTo("label", e)}
            onDoubleClick={() => setEditing(true)}
            title={editing ? undefined : "Drag to move · double-click to edit"}
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
            onPointerDown={(e) => dragTo("center", e)}
            onDoubleClick={(e) => { e.stopPropagation(); patchData({ centerX: undefined, centerY: undefined }); }}
            title="Drag to route the edge · double-click to reset"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all", width: 13, height: 13, borderRadius: 9999,
              background: "#fff", border: `2px solid ${color}`, cursor: "grab",
              boxShadow: "0 1px 3px rgba(0,0,0,.3)",
            }}
          />
        )}
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
