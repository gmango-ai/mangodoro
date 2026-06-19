import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from "@xyflow/react";

// Edge with a double-click-to-edit center label. This is the default
// edge type for the whiteboard so any connection can be annotated
// ("yes" / "no" / "then" …) — the bit that turns boxes-and-arrows into
// an actual flowchart.
//
// When there's no label the chip only shows while the edge is selected
// (as a faint "+ label" affordance) so unlabelled flows stay clean.
const EditableEdge = memo(function EditableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, style, data, selected,
}) {
  const { setEdges } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data?.label || "");
  const inputRef = useRef(null);

  useEffect(() => { setDraft(data?.label || ""); }, [data?.label]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12,
  });

  const label = data?.label || "";
  const commit = useCallback(() => {
    setEdges((eds) => eds.map((e) => (
      e.id === id ? { ...e, data: { ...e.data, label: draft.trim() } } : e
    )));
    setEditing(false);
  }, [id, draft, setEdges]);

  const show = editing || label || selected;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {show && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
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
              <span
                className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 text-white cursor-text"
                style={{ background: "#0ea5e9" }}
                title="Double-click to edit label"
              >
                {label}
              </span>
            ) : (
              <span
                className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 text-white/95 cursor-text"
                style={{ background: "rgba(14,165,233,.85)" }}
                title="Double-click to add a label"
              >
                + label
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const EDGE_TYPES = { editable: EditableEdge };
