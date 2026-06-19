import { Square, Circle, Diamond, ArrowRight, Minus } from "lucide-react";
import { MarkerType } from "@xyflow/react";

// Floating properties panel for the current selection. Shows node tools
// (shape / fill / border / text size) or edge tools (end caps / line
// style / color) depending on what's selected.

const FILL_SWATCHES = ["#ffffff", "#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#ddd6fe", "#fed7aa", "#fecaca", "#e2e8f0"];
const STROKE_SWATCHES = ["#0ea5e9", "#0f172a", "#ef4444", "#f97316", "#22c55e", "#8b5cf6", "#64748b"];
const STICKY_COLORS = ["yellow", "pink", "blue", "green", "purple", "orange", "coral", "slate"];
const STICKY_HEX = {
  yellow: "#fde68a", pink: "#fbcfe8", blue: "#bfdbfe", green: "#bbf7d0",
  purple: "#ddd6fe", orange: "#fed7aa", coral: "#fecaca", slate: "#e2e8f0",
};
const FONT_SIZES = [{ k: "S", v: 12 }, { k: "M", v: 14 }, { k: "L", v: 18 }, { k: "XL", v: 24 }];

function Row({ label, dark, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`text-[10px] font-bold uppercase tracking-wide w-11 shrink-0 mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>{label}</span>
      <div className="flex items-center gap-1 flex-wrap">{children}</div>
    </div>
  );
}

function Swatch({ color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      className="w-5 h-5 rounded-full border border-black/15"
      style={{ background: color, outline: active ? "2px solid #f97316" : "none", outlineOffset: 1 }}
    />
  );
}

function Seg({ active, onClick, title, dark, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 h-6 rounded-md text-[11px] font-semibold inline-flex items-center justify-center transition-colors ${
        active
          ? "bg-[var(--color-accent)] text-white"
          : dark ? "bg-white/10 text-slate-300 hover:bg-white/20" : "bg-black/5 text-slate-500 hover:bg-black/10"
      }`}
    >
      {children}
    </button>
  );
}

export default function Inspector({ node, edge, dark, patchNodeData, setNodeType, patchEdge }) {
  if (!node && !edge) return null;
  const panelCls = `w-56 p-2.5 rounded-2xl border shadow-lg space-y-2 pointer-events-auto ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
  }`;
  const stop = (e) => e.stopPropagation();

  if (node) {
    const isSticky = node.type === "sticky";
    const isShape = node.type === "rect" || node.type === "ellipse" || node.type === "diamond";
    const isText = node.type === "text";
    const curFont = node.data?.fontSize || (isText ? 16 : isSticky ? 13 : 13);
    return (
      <div className={panelCls} onPointerDown={stop} onClick={stop}>
        {isShape && (
          <Row label="Shape" dark={dark}>
            <Seg active={node.type === "rect"} onClick={() => setNodeType("rect")} title="Rectangle" dark={dark}><Square className="w-3.5 h-3.5" /></Seg>
            <Seg active={node.type === "ellipse"} onClick={() => setNodeType("ellipse")} title="Ellipse" dark={dark}><Circle className="w-3.5 h-3.5" /></Seg>
            <Seg active={node.type === "diamond"} onClick={() => setNodeType("diamond")} title="Diamond" dark={dark}><Diamond className="w-3.5 h-3.5" /></Seg>
          </Row>
        )}
        {isSticky ? (
          <Row label="Color" dark={dark}>
            {STICKY_COLORS.map((c) => (
              <Swatch key={c} color={STICKY_HEX[c]} active={(node.data?.color || "yellow") === c} onClick={() => patchNodeData({ color: c })} />
            ))}
          </Row>
        ) : !isText ? (
          <Row label="Fill" dark={dark}>
            {FILL_SWATCHES.map((c) => (
              <Swatch key={c} color={c} active={(node.data?.fill || "#ffffff") === c} onClick={() => patchNodeData({ fill: c })} />
            ))}
          </Row>
        ) : null}
        {isShape && (
          <Row label="Border" dark={dark}>
            {STROKE_SWATCHES.map((c) => (
              <Swatch key={c} color={c} active={(node.data?.stroke || "#0ea5e9") === c} onClick={() => patchNodeData({ stroke: c })} />
            ))}
          </Row>
        )}
        <Row label="Text" dark={dark}>
          {FONT_SIZES.map((f) => (
            <Seg key={f.k} active={curFont === f.v} onClick={() => patchNodeData({ fontSize: f.v })} title={`${f.v}px`} dark={dark}>{f.k}</Seg>
          ))}
        </Row>
      </div>
    );
  }

  // ── edge ──
  const stroke = edge.style?.stroke || "#0ea5e9";
  const dashed = !!edge.style?.strokeDasharray;
  const hasEnd = !!edge.markerEnd;
  const hasStart = !!edge.markerStart;
  const mk = (color) => ({ type: MarkerType.ArrowClosed, color });
  return (
    <div className={panelCls} onPointerDown={stop} onClick={stop}>
      <Row label="Start" dark={dark}>
        <Seg active={!hasStart} onClick={() => patchEdge({ markerStart: undefined })} title="No cap" dark={dark}><Minus className="w-3.5 h-3.5" /></Seg>
        <Seg active={hasStart} onClick={() => patchEdge({ markerStart: mk(stroke) })} title="Arrow" dark={dark}><ArrowRight className="w-3.5 h-3.5 -scale-x-100" /></Seg>
      </Row>
      <Row label="End" dark={dark}>
        <Seg active={!hasEnd} onClick={() => patchEdge({ markerEnd: undefined })} title="No cap" dark={dark}><Minus className="w-3.5 h-3.5" /></Seg>
        <Seg active={hasEnd} onClick={() => patchEdge({ markerEnd: mk(stroke) })} title="Arrow" dark={dark}><ArrowRight className="w-3.5 h-3.5" /></Seg>
      </Row>
      <Row label="Line" dark={dark}>
        <Seg active={!dashed} onClick={() => patchEdge({ style: { ...edge.style, strokeDasharray: undefined } })} title="Solid" dark={dark}>Solid</Seg>
        <Seg active={dashed} onClick={() => patchEdge({ style: { ...edge.style, strokeDasharray: "6 4" } })} title="Dashed" dark={dark}>Dashed</Seg>
      </Row>
      <Row label="Color" dark={dark}>
        {STROKE_SWATCHES.map((c) => (
          <Swatch
            key={c}
            color={c}
            active={stroke === c}
            onClick={() => patchEdge({
              style: { ...edge.style, stroke: c },
              ...(hasEnd ? { markerEnd: mk(c) } : {}),
              ...(hasStart ? { markerStart: mk(c) } : {}),
            })}
          />
        ))}
      </Row>
    </div>
  );
}
