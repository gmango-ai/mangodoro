import { Circle, Diamond, ArrowRight, ChevronRight, Minus } from "lucide-react";
import { MarkerType } from "@xyflow/react";
import { SHAPES, ShapeSvg, setPreferredStickyColor, STICKY_PALETTE, stickyHex } from "./nodes";

const LEGACY_SHAPE = { rect: "process", ellipse: "ellipse", diamond: "diamond" };
function ShapeMini({ shape }) {
  return (
    <svg width={24} height={16} viewBox="0 0 24 16" style={{ display: "block" }}>
      <ShapeSvg shape={shape} w={24} h={16} fill="none" stroke="currentColor" sw={1.5} />
    </svg>
  );
}

// Edge end-cap options. Built-in arrow markers carry a colour; the dot /
// diamond reference custom SVG markers (see EdgeMarkerDefs) that follow
// the stroke colour, so they need no colour baked in.
const CAPS = [
  { k: "none", title: "None", icon: () => <Minus className="w-3.5 h-3.5" /> },
  { k: "arrow", title: "Arrow", icon: (start) => <ArrowRight className={`w-3.5 h-3.5 ${start ? "-scale-x-100" : ""}`} /> },
  { k: "open", title: "Open arrow", icon: (start) => <ChevronRight className={`w-3.5 h-3.5 ${start ? "-scale-x-100" : ""}`} /> },
  { k: "dot", title: "Dot", icon: () => <Circle className="w-3 h-3 fill-current" /> },
  { k: "diamond", title: "Diamond", icon: () => <Diamond className="w-3.5 h-3.5 fill-current" /> },
];
function capValue(kind, color) {
  switch (kind) {
    case "arrow": return { type: MarkerType.ArrowClosed, color };
    case "open": return { type: MarkerType.Arrow, color };
    case "dot": return "url(#wb-dot)";
    case "diamond": return "url(#wb-diamond)";
    default: return undefined;
  }
}
function capKind(m) {
  if (!m) return "none";
  if (typeof m === "string") return m.includes("wb-dot") ? "dot" : m.includes("wb-diamond") ? "diamond" : "arrow";
  return m.type === MarkerType.Arrow ? "open" : "arrow";
}
function recolorMarker(m, color) {
  if (m && typeof m === "object") return { ...m, color };
  return m; // custom string markers follow the stroke via context-stroke
}

// Floating properties panel for the current selection. Shows node tools
// (shape / fill / border / text size) or edge tools (end caps / line
// style / color) depending on what's selected.

const FILL_SWATCHES = ["#ffffff", "#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#ddd6fe", "#fed7aa", "#fecaca", "#e2e8f0"];
const STROKE_SWATCHES = ["#0ea5e9", "#0f172a", "#ef4444", "#f97316", "#22c55e", "#8b5cf6", "#64748b"];
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
    const isShape = ["shape", "rect", "ellipse", "diamond"].includes(node.type);
    const isText = node.type === "text";
    const curFont = node.data?.fontSize || (isText ? 16 : isSticky ? 13 : 13);
    const curShape = node.data?.shape || LEGACY_SHAPE[node.type] || "process";
    return (
      <div className={panelCls} onPointerDown={stop} onClick={stop}>
        {isShape && (
          <div>
            <span className={`text-[10px] font-bold uppercase tracking-wide block mb-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>Shape</span>
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.label}
                  onClick={() => patchNodeData({ shape: s.key })}
                  className={`h-7 rounded-md flex items-center justify-center transition-colors ${
                    curShape === s.key
                      ? "bg-[var(--color-accent)] text-white"
                      : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-black/5"
                  }`}
                >
                  <ShapeMini shape={s.key} />
                </button>
              ))}
            </div>
          </div>
        )}
        {isSticky ? (
          <Row label="Color" dark={dark}>
            {STICKY_PALETTE.map((hex) => (
              <Swatch
                key={hex}
                color={hex}
                active={stickyHex(node.data?.color).toLowerCase() === hex.toLowerCase()}
                onClick={() => { patchNodeData({ color: hex }); setPreferredStickyColor(hex); }}
              />
            ))}
            <label title="Custom color" className="w-5 h-5 rounded-full border border-black/15 overflow-hidden inline-flex cursor-pointer">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(stickyHex(node.data?.color)) ? stickyHex(node.data?.color) : "#fde68a"}
                onChange={(e) => { patchNodeData({ color: e.target.value }); setPreferredStickyColor(e.target.value); }}
                style={{ width: 28, height: 28, margin: -4, padding: 0, border: "none", background: "none", cursor: "pointer" }}
              />
            </label>
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
  const width = edge.style?.strokeWidth || 2;
  const dash = edge.style?.strokeDasharray || "";
  const routing = edge.data?.routing || "smooth";
  const startKind = capKind(edge.markerStart);
  const endKind = capKind(edge.markerEnd);
  const setStyle = (patch) => patchEdge({ style: { ...edge.style, ...patch } });
  const setData = (patch) => patchEdge({ data: { ...edge.data, ...patch } });
  return (
    <div className={panelCls} onPointerDown={stop} onClick={stop}>
      <Row label="Route" dark={dark}>
        <Seg active={routing === "straight"} onClick={() => setData({ routing: "straight" })} title="Straight line" dark={dark}>Straight</Seg>
        <Seg active={routing === "smooth"} onClick={() => setData({ routing: "smooth" })} title="Elbow / orthogonal" dark={dark}>Elbow</Seg>
        <Seg active={routing === "curved"} onClick={() => setData({ routing: "curved" })} title="Curved" dark={dark}>Curved</Seg>
      </Row>
      <Row label="Start" dark={dark}>
        {CAPS.map((cap) => (
          <Seg key={cap.k} active={startKind === cap.k} onClick={() => patchEdge({ markerStart: capValue(cap.k, stroke) })} title={cap.title} dark={dark}>{cap.icon(true)}</Seg>
        ))}
      </Row>
      <Row label="End" dark={dark}>
        {CAPS.map((cap) => (
          <Seg key={cap.k} active={endKind === cap.k} onClick={() => patchEdge({ markerEnd: capValue(cap.k, stroke) })} title={cap.title} dark={dark}>{cap.icon(false)}</Seg>
        ))}
      </Row>
      <Row label="Line" dark={dark}>
        <Seg active={!dash} onClick={() => setStyle({ strokeDasharray: undefined })} title="Solid" dark={dark}>Solid</Seg>
        <Seg active={dash === "6 4"} onClick={() => setStyle({ strokeDasharray: "6 4" })} title="Dashed" dark={dark}>Dashed</Seg>
        <Seg active={dash === "1.5 5"} onClick={() => setStyle({ strokeDasharray: "1.5 5" })} title="Dotted" dark={dark}>Dotted</Seg>
      </Row>
      <Row label="Weight" dark={dark}>
        <Seg active={width <= 1.5} onClick={() => setStyle({ strokeWidth: 1.5 })} title="Thin" dark={dark}>S</Seg>
        <Seg active={width > 1.5 && width < 3} onClick={() => setStyle({ strokeWidth: 2 })} title="Medium" dark={dark}>M</Seg>
        <Seg active={width >= 3} onClick={() => setStyle({ strokeWidth: 3.5 })} title="Thick" dark={dark}>L</Seg>
      </Row>
      <Row label="Color" dark={dark}>
        {STROKE_SWATCHES.map((c) => (
          <Swatch
            key={c}
            color={c}
            active={stroke === c}
            onClick={() => patchEdge({
              style: { ...edge.style, stroke: c },
              ...(edge.markerEnd ? { markerEnd: recolorMarker(edge.markerEnd, c) } : {}),
              ...(edge.markerStart ? { markerStart: recolorMarker(edge.markerStart, c) } : {}),
            })}
          />
        ))}
      </Row>
      <Row label="Label" dark={dark}>
        <Seg active={(edge.data?.labelStyle || "pill") === "pill"} onClick={() => setData({ labelStyle: "pill" })} title="Filled pill" dark={dark}>Pill</Seg>
        <Seg active={edge.data?.labelStyle === "mask"} onClick={() => setData({ labelStyle: "mask" })} title="Text only (masks the line)" dark={dark}>Text</Seg>
      </Row>
    </div>
  );
}
