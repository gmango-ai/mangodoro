import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeResizer, useReactFlow } from "@xyflow/react";

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

// Four-side connection handles. Source + target on every side so a
// user can pull a connector from any edge — the FigJam idiom that
// makes flowcharts feel natural.
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
      <Handle type="target" position={Position.Top}    id="tt" style={{ ...base, opacity: 0 }} />
      <Handle type="target" position={Position.Right}  id="rt" style={{ ...base, opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bt" style={{ ...base, opacity: 0 }} />
      <Handle type="target" position={Position.Left}   id="lt" style={{ ...base, opacity: 0 }} />
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
        style={{ fontSize: 13, lineHeight: 1.35 }}
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
        style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}
      />
    </div>
  );
});

// ─── RectShape ─────────────────────────────────────────────────────

export const RectNode = memo(function RectNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: data?.fill || "#fff",
        border: `2px solid ${selected ? "#f97316" : data?.stroke || "#0ea5e9"}`,
        borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 10, color: "#0f172a",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={80} minHeight={50}
        lineStyle={{ borderColor: "#f97316" }}
        handleStyle={{ background: "#f97316", border: "2px solid #fff" }}
      />
      <FourHandles />
      <EditableText
        value={data?.text}
        onChange={setText}
        placeholder=""
        style={{ fontSize: 13, fontWeight: 600, textAlign: "center" }}
      />
    </div>
  );
});

// ─── EllipseShape ──────────────────────────────────────────────────

export const EllipseNode = memo(function EllipseNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: data?.fill || "#fff",
        border: `2px solid ${selected ? "#f97316" : data?.stroke || "#0ea5e9"}`,
        borderRadius: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 10, color: "#0f172a",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={80} minHeight={50}
        lineStyle={{ borderColor: "#f97316" }}
        handleStyle={{ background: "#f97316", border: "2px solid #fff" }}
      />
      <FourHandles />
      <EditableText
        value={data?.text}
        onChange={setText}
        placeholder=""
        style={{ fontSize: 13, fontWeight: 600, textAlign: "center" }}
      />
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
  rect: RectNode,
  ellipse: EllipseNode,
  zone: ZoneNode,
};
