import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeResizer, useReactFlow } from "@xyflow/react";
import { Target, ChevronDown, Building2, User } from "lucide-react";
import { useTeam } from "../../context/TeamContext";

// Shared text editor used inside the sticky / text / shape nodes.
// Stops propagating wheel + pointerdown so the canvas doesn't pan
// under the cursor mid-edit.
function EditableText({ value, onChange, placeholder, className, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const textareaRef = useRef(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (draft !== value) onChange?.(draft);
    setEditing(false);
  }, [draft, value, onChange]);

  if (!editing) {
    return (
      <div
        className={`whitespace-pre-wrap break-words ${className || ""}`}
        style={style}
        onDoubleClick={() => setEditing(true)}
      >
        {value || (
          <span style={{ opacity: 0.45, fontStyle: "italic" }}>
            {placeholder || "Double-click to edit…"}
          </span>
        )}
      </div>
    );
  }

  return (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { commit(); }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className={`resize-none border-none outline-none bg-transparent ${className || ""}`}
      style={{ ...style, width: "100%", height: "100%" }}
    />
  );
}

// Shared hook: a stable text-changer for the current node. Wraps
// useReactFlow().setNodes so each node component stays small.
function useNodeTextUpdater(id) {
  const { setNodes } = useReactFlow();
  return useCallback((text) => {
    setNodes((nds) => nds.map((n) => (
      n.id === id ? { ...n, data: { ...n.data, text } } : n
    )));
  }, [id, setNodes]);
}

// Patch arbitrary data fields on the current node.
function useNodeDataPatcher(id) {
  const { setNodes } = useReactFlow();
  return useCallback((patch) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [id, setNodes]);
}

// One connection handle per side. With ConnectionMode.Loose on the
// canvas these act as both source and target, and a connection follows
// the DRAG DIRECTION (so the arrow points where you dragged). The prior
// design stacked an invisible target handle over each source handle,
// which made drags start on the target and reversed the arrow.
function FourHandles({ visible = true }) {
  const base = {
    width: 9, height: 9, background: "#0ea5e9",
    border: "2px solid #fff", borderRadius: 9999,
    opacity: visible ? 1 : 0,
  };
  return (
    <>
      <Handle type="source" position={Position.Top}    id="t" style={base} />
      <Handle type="source" position={Position.Right}  id="r" style={base} />
      <Handle type="source" position={Position.Bottom} id="b" style={base} />
      <Handle type="source" position={Position.Left}   id="l" style={base} />
    </>
  );
}

// ─── StickyNote ───────────────────────────────────────────────────

const STICKY_BG = {
  yellow: "#fde68a", pink: "#fbcfe8", blue: "#bfdbfe", green: "#bbf7d0",
  purple: "#ddd6fe", orange: "#fed7aa", coral: "#fecaca", slate: "#e2e8f0",
};

export const StickyNode = memo(function StickyNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const bg = STICKY_BG[data?.color] || STICKY_BG.yellow;
  return (
    <div
      style={{
        width: 160, height: 160, padding: 10,
        background: bg,
        borderRadius: 4,
        boxShadow: selected
          ? "0 0 0 2px #f97316, 0 16px 32px -12px rgba(120,80,20,.55)"
          : "0 7px 14px -7px rgba(120,80,20,.5)",
        display: "flex", flexDirection: "column", color: "#3a2a10",
        fontFamily: "inherit",
      }}
    >
      <FourHandles />
      {data?.author && (
        <div
          style={{
            fontSize: 9, fontWeight: 800, opacity: 0.6, marginBottom: 4,
            textTransform: "uppercase", letterSpacing: ".06em",
          }}
        >
          {data.author}
        </div>
      )}
      <EditableText
        value={data?.text}
        onChange={setText}
        placeholder="Type a note…"
        className="flex-1"
        style={{ fontSize: data?.fontSize ?? 13, lineHeight: 1.35 }}
      />
    </div>
  );
});

// ─── TextNode ──────────────────────────────────────────────────────

export const TextNode = memo(function TextNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  return (
    <div
      style={{
        minWidth: 180, padding: "8px 12px",
        background: selected ? "rgba(249,115,22,.06)" : "transparent",
        borderRadius: 8,
        boxShadow: selected ? "0 0 0 2px #f97316" : "none",
        color: "var(--color-text)",
      }}
    >
      <FourHandles visible={false} />
      <EditableText
        value={data?.text}
        onChange={setText}
        placeholder="Type some text…"
        style={{ fontSize: data?.fontSize ?? 16, fontWeight: 700, lineHeight: 1.3 }}
      />
    </div>
  );
});

// ─── Flowchart shapes (SVG) ───────────────────────────────────────
//
// One SVG-backed node renders the whole flowchart catalogue. data.shape
// picks the geometry; it's drawn at the node's real pixel size (tracked
// via ResizeObserver) so nothing distorts at any aspect ratio. Legacy
// "rect"/"ellipse"/"diamond" node types map to a sensible shape.

export const SHAPES = [
  { key: "process", label: "Process" },
  { key: "rounded", label: "Rounded" },
  { key: "diamond", label: "Decision" },
  { key: "terminator", label: "Start / End" },
  { key: "parallelogram", label: "Data" },
  { key: "hexagon", label: "Preparation" },
  { key: "document", label: "Document" },
  { key: "cylinder", label: "Database" },
  { key: "ellipse", label: "Ellipse" },
  { key: "triangle", label: "Triangle" },
];

const LEGACY_SHAPE = { rect: "process", ellipse: "ellipse", diamond: "diamond" };

// SVG children for a shape drawn within w×h (stroke inset by sw so it's
// never clipped). Used both by the node and the toolbar/inspector previews.
export function ShapeSvg({ shape, w, h, fill, stroke, sw = 2 }) {
  const p = { fill, stroke, strokeWidth: sw, strokeLinejoin: "round" };
  const x0 = sw / 2, y0 = sw / 2, x1 = w - sw / 2, y1 = h - sw / 2, cx = w / 2, cy = h / 2;
  switch (shape) {
    case "ellipse":
      return <ellipse cx={cx} cy={cy} rx={(w - sw) / 2} ry={(h - sw) / 2} {...p} />;
    case "rounded":
      return <rect x={x0} y={y0} width={w - sw} height={h - sw} rx={14} ry={14} {...p} />;
    case "terminator":
      return <rect x={x0} y={y0} width={w - sw} height={h - sw} rx={(h - sw) / 2} ry={(h - sw) / 2} {...p} />;
    case "diamond":
      return <polygon points={`${cx},${y0} ${x1},${cy} ${cx},${y1} ${x0},${cy}`} {...p} />;
    case "triangle":
      return <polygon points={`${cx},${y0} ${x1},${y1} ${x0},${y1}`} {...p} />;
    case "parallelogram": {
      const s = Math.min(w * 0.22, h * 0.5);
      return <polygon points={`${x0 + s},${y0} ${x1},${y0} ${x1 - s},${y1} ${x0},${y1}`} {...p} />;
    }
    case "hexagon": {
      const s = Math.min(w * 0.2, h * 0.5);
      return <polygon points={`${x0 + s},${y0} ${x1 - s},${y0} ${x1},${cy} ${x1 - s},${y1} ${x0 + s},${y1} ${x0},${cy}`} {...p} />;
    }
    case "document": {
      const wob = Math.min(h * 0.16, 22);
      return <path d={`M${x0},${y0} H${x1} V${h - wob} C${w * 0.72},${h + wob * 0.5} ${w * 0.28},${h - wob * 2.4} ${x0},${h - wob} Z`} {...p} />;
    }
    case "cylinder": {
      const ry = Math.min(h * 0.16, 16);
      return (
        <>
          <path d={`M${x0},${ry} V${h - ry} A${(w - sw) / 2},${ry} 0 0 0 ${x1},${h - ry} V${ry}`} {...p} />
          <ellipse cx={cx} cy={ry} rx={(w - sw) / 2} ry={ry} {...p} />
        </>
      );
    }
    case "process":
    default:
      return <rect x={x0} y={y0} width={w - sw} height={h - sw} {...p} />;
  }
}

function useNodeSize(initial) {
  const ref = useRef(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width && r.height) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export const ShapeNode = memo(function ShapeNode({ id, type, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const [ref, size] = useNodeSize({ w: 180, h: 100 });
  const shape = data?.shape || LEGACY_SHAPE[type] || "process";
  const fill = data?.fill || "#fff";
  const stroke = selected ? "#f97316" : (data?.stroke || "#0ea5e9");
  return (
    <div ref={ref} style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeResizer
        isVisible={selected}
        minWidth={70} minHeight={50}
        lineStyle={{ borderColor: "#f97316" }}
        handleStyle={{ background: "#f97316", border: "2px solid #fff" }}
      />
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ position: "absolute", inset: 0, overflow: "visible", display: "block" }}
      >
        <ShapeSvg shape={shape} w={size.w} h={size.h} fill={fill} stroke={stroke} sw={2} />
      </svg>
      <FourHandles />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 14px" }}>
        <EditableText
          value={data?.text}
          onChange={setText}
          placeholder=""
          style={{ fontSize: data?.fontSize ?? 13, fontWeight: 600, textAlign: "center", color: "#0f172a" }}
        />
      </div>
    </div>
  );
});

// ─── GoalNode (first-class, linkable to a department or person) ────

export const GoalNode = memo(function GoalNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const patch = useNodeDataPatcher(id);
  const { orgTeams = [], teamMembers = [] } = useTeam() || {};
  const [pickerOpen, setPickerOpen] = useState(false);
  const linked = data?.linkType && data?.linkId;
  const linkColor = data?.linkColor || "#f59e0b";
  return (
    <div
      style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "#fff", borderRadius: 14,
        border: `2px solid ${selected ? "#f97316" : "#f59e0b"}`,
        boxShadow: selected ? "0 0 0 2px #f9731633, 0 12px 28px -14px rgba(0,0,0,.4)" : "0 8px 20px -12px rgba(0,0,0,.3)",
        color: "#0f172a",
      }}
    >
      <NodeResizer isVisible={selected} minWidth={200} minHeight={120} lineStyle={{ borderColor: "#f97316" }} handleStyle={{ background: "#f97316", border: "2px solid #fff" }} />
      <FourHandles />
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "linear-gradient(120deg,#f59e0b,#f97316)", color: "#fff", borderRadius: "12px 12px 0 0" }}>
        <Target style={{ width: 14, height: 14 }} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em" }}>GOAL</span>
      </div>
      <div style={{ flex: 1, padding: 10, minHeight: 0 }}>
        <EditableText value={data?.text} onChange={setText} placeholder="Write the goal…" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }} />
      </div>
      <div className="nodrag nowheel" style={{ position: "relative", padding: "6px 10px", borderTop: "1px solid rgba(0,0,0,.07)" }} onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: linked ? "#fff" : "#64748b", background: linked ? linkColor : "transparent", padding: linked ? "2px 8px" : 0, borderRadius: 9999 }}
        >
          {data?.linkType === "user" ? <User style={{ width: 12, height: 12 }} /> : <Building2 style={{ width: 12, height: 12 }} />}
          {linked ? data.linkName : "Link to a team or person"}
          <ChevronDown style={{ width: 11, height: 11, opacity: 0.6 }} />
        </button>
        {pickerOpen && (
          <div style={{ position: "absolute", bottom: 34, left: 8, zIndex: 40, width: 196, maxHeight: 220, overflowY: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 16px 36px -16px rgba(0,0,0,.45)", padding: 4 }}>
            {orgTeams.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em", padding: "4px 8px 2px" }}>Departments</div>}
            {orgTeams.map((t) => (
              <button key={t.id} type="button" onClick={() => { patch({ linkType: "department", linkId: t.id, linkName: t.name, linkColor: t.color || "#f59e0b" }); setPickerOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "4px 8px", borderRadius: 8, fontSize: 12, color: "#0f172a" }}>
                <span style={{ width: 8, height: 8, borderRadius: 9999, background: t.color || "#94a3b8", flexShrink: 0 }} />
                {t.name}
              </button>
            ))}
            {teamMembers.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em", padding: "6px 8px 2px" }}>People</div>}
            {teamMembers.map((m) => (
              <button key={m.user_id} type="button" onClick={() => { patch({ linkType: "user", linkId: m.user_id, linkName: m.name || "Member", linkColor: "#64748b" }); setPickerOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "4px 8px", borderRadius: 8, fontSize: 12, color: "#0f172a" }}>
                <User style={{ width: 12, height: 12, color: "#94a3b8" }} />
                {m.name || "Member"}
              </button>
            ))}
            {linked && (
              <button type="button" onClick={() => { patch({ linkType: null, linkId: null, linkName: null, linkColor: null }); setPickerOpen(false); }}
                style={{ width: "100%", textAlign: "left", padding: "4px 8px", marginTop: 2, borderRadius: 8, fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
                Clear link
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── ZoneNode ─────────────────────────────────────────────────────

export const ZoneNode = memo(function ZoneNode({ data }) {
  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: data?.bg || "#f1f5f9",
        border: `2px solid ${data?.border || "#e2e8f0"}`,
        borderRadius: 22,
        pointerEvents: "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: 11, flexShrink: 0,
            background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: data?.tint || "#0f172a",
            fontSize: 18,
            boxShadow: "0 1px 2px rgba(15,23,42,.08)",
          }}
        >
          {data?.icon || "·"}
        </div>
        <span
          style={{
            fontSize: 19, fontWeight: 800, letterSpacing: "-.01em",
            color: "#3a2a10",
          }}
        >
          {data?.label || "Zone"}
        </span>
      </div>
    </div>
  );
});

export const NODE_TYPES = {
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  goal: GoalNode,
  // Legacy aliases — old snapshots store these node types.
  rect: ShapeNode,
  ellipse: ShapeNode,
  diamond: ShapeNode,
  zone: ZoneNode,
};
