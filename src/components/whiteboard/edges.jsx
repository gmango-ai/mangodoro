import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from "@xyflow/react";

// Rounded polyline through source → waypoints → target. Each interior
// point gets a rounded corner (the FigJam look) instead of a hard angle.
function roundedPath(points, r = 10) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
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

// Editable edge: a double-click center label PLUS draggable routing.
// Select the edge to reveal its bend handles — drag a midpoint dot to add
// a bend, drag a solid dot to move one, double-click a solid dot to drop
// it. Waypoints live in edge.data.waypoints (flow coords) so they persist
// and broadcast like everything else on the board.
const EditableEdge = memo(function EditableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, style, data, selected,
}) {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data?.label || "");
  const inputRef = useRef(null);

  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const waypoints = data?.waypoints || [];
  const pts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }];

  let path, labelX, labelY;
  if (waypoints.length) {
    path = roundedPath(pts);
    const m = pts[Math.floor(pts.length / 2)];
    labelX = m.x; labelY = m.y;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12,
    });
  }

  const label = data?.label || "";
  const commit = useCallback(() => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, label: draft.trim() } } : e)));
    setEditing(false);
  }, [id, draft, setEdges]);

  const patchWaypoints = useCallback((fn) => {
    setEdges((eds) => eds.map((e) => (
      e.id === id ? { ...e, data: { ...e.data, waypoints: fn(e.data?.waypoints || []) } } : e
    )));
  }, [id, setEdges]);

  const dragWaypoint = useCallback((index, e) => {
    e.stopPropagation();
    const onMove = (ev) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      patchWaypoints((wps) => wps.map((w, i) => (i === index ? { x: p.x, y: p.y } : w)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [patchWaypoints, screenToFlowPosition]);

  // Drag a segment midpoint → insert a bend there and start dragging it.
  const addAndDrag = useCallback((segIndex, midpoint, e) => {
    e.stopPropagation();
    patchWaypoints((wps) => {
      const next = [...wps];
      next.splice(segIndex, 0, midpoint);
      return next;
    });
    dragWaypoint(segIndex, e);
  }, [patchWaypoints, dragWaypoint]);

  const showLabel = editing || label || selected;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {showLabel && (
          <div
            className="nodrag nopan"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
            onDoubleClick={() => setEditing(true)}
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
                className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 outline-none text-white"
                style={{ background: "#0ea5e9", width: Math.max(48, draft.length * 7 + 22) }}
              />
            ) : label ? (
              <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 text-white cursor-text" style={{ background: "#0ea5e9" }} title="Double-click to edit label">{label}</span>
            ) : (
              <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 text-white/95 cursor-text" style={{ background: "rgba(14,165,233,.85)" }} title="Double-click to add a label">+ label</span>
            )}
          </div>
        )}

        {selected && (
          <>
            {/* Segment midpoints — drag to add a bend. */}
            {pts.slice(0, -1).map((p, i) => {
              const q = pts[i + 1];
              const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
              return (
                <div
                  key={`add-${i}`}
                  className="nodrag nopan"
                  onPointerDown={(e) => addAndDrag(i, { x: mx, y: my }, e)}
                  title="Drag to add a bend"
                  style={{
                    position: "absolute",
                    transform: `translate(-50%,-50%) translate(${mx}px,${my}px)`,
                    pointerEvents: "all", width: 9, height: 9, borderRadius: 9999,
                    background: "rgba(14,165,233,.45)", border: "1.5px solid #fff", cursor: "grab",
                  }}
                />
              );
            })}
            {/* Existing bends — drag to move, double-click to remove. */}
            {waypoints.map((wp, i) => (
              <div
                key={`wp-${i}`}
                className="nodrag nopan"
                onPointerDown={(e) => dragWaypoint(i, e)}
                onDoubleClick={(e) => { e.stopPropagation(); patchWaypoints((wps) => wps.filter((_, j) => j !== i)); }}
                title="Drag to bend · double-click to remove"
                style={{
                  position: "absolute",
                  transform: `translate(-50%,-50%) translate(${wp.x}px,${wp.y}px)`,
                  pointerEvents: "all", width: 12, height: 12, borderRadius: 9999,
                  background: "#fff", border: "2px solid #0ea5e9", cursor: "grab",
                }}
              />
            ))}
          </>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

export const EDGE_TYPES = { editable: EditableEdge };
