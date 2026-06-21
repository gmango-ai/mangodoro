import { useState } from "react";
import { Magnet } from "lucide-react";
import { SHAPES, ShapeSvg, setPreferredStickyColor, STICKY_PALETTE, stickyHex } from "./nodes";
import { Pill, ToolDivider, Dropdown, SwatchGrid, Opt } from "./toolbarUI";
import { nodeSnaps } from "./snapping";

const LEGACY_SHAPE = { rect: "process", ellipse: "ellipse", diamond: "diamond" };

function ShapeMini({ shape }) {
  return (
    <svg width={24} height={16} viewBox="0 0 24 16" style={{ display: "block" }}>
      <ShapeSvg shape={shape} w={24} h={16} fill="none" stroke="currentColor" sw={1.5} />
    </svg>
  );
}

const FONT_SIZES = [
  { label: "Small", v: 14 },
  { label: "Medium", v: 18 },
  { label: "Large", v: 26 },
  { label: "X-Large", v: 44 }, // a deliberate big jump — for headings / frame titles
];

// Shape catalogue, shown as a compact grid inside the Shape dropdown.
function ShapePicker({ value, onPick }) {
  return (
    <div className="grid grid-cols-5 gap-1 p-1" style={{ width: 180 }}>
      {SHAPES.map((s) => (
        <button
          key={s.key}
          type="button"
          title={s.label}
          onClick={() => onPick(s.key)}
          className={`h-7 rounded-md flex items-center justify-center ${
            value === s.key ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"
          }`}
        >
          <ShapeMini shape={s.key} />
        </button>
      ))}
    </div>
  );
}

// Sticky pastels + a custom-colour well, on the dark panel. `onPick` is the
// commit (swatch click — applies + closes); `onLive` previews the native
// colour picker as you drag, without closing the panel.
function StickyPicker({ value, onPick, onLive }) {
  const v = (value || "").toLowerCase();
  return (
    <div className="grid gap-2.5 p-2.5" style={{ gridTemplateColumns: "repeat(6, 24px)", justifyContent: "center" }}>
      {STICKY_PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          onClick={() => onPick(hex)}
          className="rounded-full border border-black/10 hover:scale-110 transition-transform"
          style={{ width: 24, height: 24, background: hex, outline: v === hex.toLowerCase() ? "2px solid #fff" : "none", outlineOffset: 2 }}
        />
      ))}
      <label
        title="Custom colour"
        className="rounded-full overflow-hidden inline-flex items-center justify-center cursor-pointer border border-white/30"
        style={{ width: 24, height: 24, background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}
      >
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#fde68a"}
          // Live-preview on the note while dragging; never auto-close the panel
          // so you can keep adjusting (click a swatch or click away to finish).
          onInput={(e) => (onLive || onPick)(e.target.value)}
          onChange={(e) => (onLive || onPick)(e.target.value)}
          style={{ width: 30, height: 30, margin: -3, padding: 0, border: "none", background: "none", cursor: "pointer", opacity: 0 }}
        />
      </label>
    </div>
  );
}

// Floating contextual toolbar for the selected node — the FigJam dark pill,
// matching the edge toolbar. Positioned above the node by React Flow's
// <NodeToolbar> at the call site. Only the controls a given node type
// supports are shown.
export default function Inspector({ node, patchNodeData }) {
  const [open, setOpen] = useState(null);
  if (!node) return null;

  const isSticky = node.type === "sticky";
  const isShape = ["shape", "rect", "ellipse", "diamond"].includes(node.type);
  const isText = node.type === "text";
  const isFrame = node.type === "frame";
  const labelBg = node.data?.labelBg; // frame title background: undefined/"none" | "tint" | hex
  const labelBgColor = labelBg === "tint" ? (node.data?.fill || "#0ea5e9") : (labelBg && labelBg !== "none" ? labelBg : null);
  const curFont = node.data?.fontSize || (isText ? 16 : isFrame ? 18 : 13);
  const curFontLabel = (FONT_SIZES.find((f) => f.v === curFont) || {}).label || `${curFont}px`;
  const curShape = node.data?.shape || LEGACY_SHAPE[node.type] || "process";
  const fill = node.data?.fill || "#ffffff";
  const stroke = node.data?.stroke || "#0ea5e9";
  const stickyColor = stickyHex(node.data?.color);
  const hasPre = isShape || isSticky || !isText; // any control before the text size
  const snapping = nodeSnaps(node); // grid + alignment snapping for this item

  const stop = (e) => e.stopPropagation();

  return (
    <div onPointerDown={stop} onClick={stop}>
      <Pill>
        {isShape && (
          <Dropdown
            openKey="shape"
            open={open}
            setOpen={setOpen}
            title="Shape"
            width={180}
            icon={<span className="flex text-white/90"><ShapeMini shape={curShape} /></span>}
          >
            <ShapePicker value={curShape} onPick={(k) => { patchNodeData({ shape: k }); setOpen(null); }} />
          </Dropdown>
        )}

        {isSticky ? (
          <Dropdown
            openKey="fill"
            open={open}
            setOpen={setOpen}
            title="Colour"
            icon={<span className="w-4 h-4 rounded-full border border-white/30" style={{ background: stickyColor }} />}
          >
            <StickyPicker
              value={stickyColor}
              onPick={(c) => { patchNodeData({ color: c }); setPreferredStickyColor(c); setOpen(null); }}
              onLive={(c) => { patchNodeData({ color: c }); setPreferredStickyColor(c); }}
            />
          </Dropdown>
        ) : !isText ? (
          <Dropdown
            openKey="fill"
            open={open}
            setOpen={setOpen}
            title="Fill"
            icon={<span className="w-4 h-4 rounded-full border border-white/30" style={{ background: fill }} />}
          >
            <SwatchGrid value={fill} onPick={(c) => { patchNodeData({ fill: c }); setOpen(null); }} />
          </Dropdown>
        ) : null}

        {isShape && (
          <Dropdown
            openKey="border"
            open={open}
            setOpen={setOpen}
            title="Border"
            icon={<span className="w-4 h-4 rounded-full border-2" style={{ borderColor: stroke }} />}
          >
            <SwatchGrid value={stroke} onPick={(c) => { patchNodeData({ stroke: c }); setOpen(null); }} />
          </Dropdown>
        )}

        {isFrame && (
          <Dropdown
            openKey="labelbg"
            open={open}
            setOpen={setOpen}
            title="Label background"
            icon={
              <span
                className="text-[12px] font-extrabold leading-none flex items-center justify-center w-5 h-4 rounded"
                style={{ background: labelBgColor || "transparent", color: labelBgColor ? "#fff" : "rgba(255,255,255,.9)", border: labelBgColor ? "none" : "1px dashed rgba(255,255,255,.4)" }}
              >T</span>
            }
          >
            <div className="p-1" style={{ width: 180 }}>
              <Opt active={!labelBg || labelBg === "none"} onClick={() => { patchNodeData({ labelBg: "none" }); setOpen(null); }}>Transparent</Opt>
              <Opt active={labelBg === "tint"} onClick={() => { patchNodeData({ labelBg: "tint" }); setOpen(null); }}>Frame colour</Opt>
              <SwatchGrid value={labelBg} onPick={(c) => { patchNodeData({ labelBg: c }); setOpen(null); }} />
            </div>
          </Dropdown>
        )}

        {hasPre && <ToolDivider />}

        <Dropdown
          openKey="text"
          open={open}
          setOpen={setOpen}
          title="Text size"
          width={120}
          icon={
            <span className="flex items-center gap-1">
              <span className="text-[13px] font-bold leading-none">Aa</span>
              <span className="text-[11px] text-white/70">{curFontLabel}</span>
            </span>
          }
        >
          {FONT_SIZES.map((f) => (
            <Opt key={f.v} active={curFont === f.v} onClick={() => { patchNodeData({ fontSize: f.v }); setOpen(null); }}>
              {f.label}
            </Opt>
          ))}
        </Dropdown>

        <ToolDivider />
        {/* Per-item snapping toggle (grid + alignment). Stickies default off. */}
        <button
          type="button"
          title={snapping ? "Snapping on — click to free this item" : "Snapping off — click to enable"}
          aria-pressed={snapping}
          onClick={() => patchNodeData({ snap: !snapping })}
          className={`h-7 px-1.5 rounded-md flex items-center transition-colors ${
            snapping ? "text-[var(--color-accent)] bg-white/10" : "text-white/50 hover:bg-white/10"
          }`}
        >
          <Magnet className="w-4 h-4" />
        </button>
      </Pill>
    </div>
  );
}
