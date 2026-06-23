import { useState } from "react";
import { Magnet, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Lock, LockOpen, BringToFront, SendToBack } from "lucide-react";
import { SHAPES, ShapeSvg, setPreferredStickyColor, STICKY_PALETTE, stickyHex, wrapActiveSelection } from "./nodes";
import { Pill, ToolDivider, Dropdown, SwatchGrid, Opt } from "./toolbarUI";
import { nodeSnaps } from "./snapping";

const LEGACY_SHAPE = { rect: "process", ellipse: "ellipse", diamond: "diamond" };

// Toggle a markdown marker around the WHOLE node text — the fallback when no
// live selection is being edited (B / I clicked on a selected-but-not-editing
// node).
function toggleWholeMarkdown(text, marker) {
  const t = text || "";
  if (!t.trim()) return t;
  const ml = marker.length;
  if (t.length >= 2 * ml && t.startsWith(marker) && t.endsWith(marker)) {
    return t.slice(ml, t.length - ml);
  }
  return marker + t + marker;
}

function ShapeMini({ shape }) {
  return (
    <svg width={24} height={16} viewBox="0 0 24 16" style={{ display: "block" }}>
      <ShapeSvg shape={shape} w={24} h={16} fill="none" stroke="currentColor" sw={1.5} />
    </svg>
  );
}

// A scale of point sizes; a few common ones carry a friendly label.
const FONT_SIZES = [
  { v: 12 },
  { v: 14, label: "Small" },
  { v: 16, label: "Normal" },
  { v: 20 },
  { v: 24, label: "Large" },
  { v: 32 },
  { v: 48, label: "Heading" },
  { v: 64 },
  { v: 72 },
  { v: 96 },
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
export default function Inspector({ node, patchNodeData, setLocked, onReorder }) {
  const [open, setOpen] = useState(null);
  if (!node) return null;

  const isSticky = node.type === "sticky";
  const isShape = ["shape", "rect", "ellipse", "diamond"].includes(node.type);
  const isText = node.type === "text";
  const isFrame = node.type === "frame";
  const labelBg = node.data?.labelBg; // frame title background: undefined/"none" | "tint" | hex
  const labelBgColor = labelBg === "tint" ? (node.data?.fill || "#0ea5e9") : (labelBg && labelBg !== "none" ? labelBg : null);
  const curFont = node.data?.fontSize || (isText ? 16 : isFrame ? 20 : 13);
  const curShape = node.data?.shape || LEGACY_SHAPE[node.type] || "process";
  const fill = node.data?.fill || "#ffffff";
  const stroke = node.data?.stroke || "#0ea5e9";
  const curStrokeWidth = node.data?.strokeWidth ?? 2;
  const curDash = node.data?.strokeDash || "solid";
  const stickyColor = stickyHex(node.data?.color);
  const hasPre = isShape || isSticky || !isText; // any control before the text size
  const snapping = nodeSnaps(node); // grid + alignment snapping for this item
  const locked = !!node.data?.locked;
  const isTextable = isSticky || isText || isShape;
  const curAlign = node.data?.textAlign || (isText ? "left" : "center");
  const curVAlign = node.data?.vAlign || "middle";
  const curTextColor = node.data?.textColor || null;

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
            <SwatchGrid value={fill} onPick={(c) => { patchNodeData({ fill: c }); setOpen(null); }} onLive={(c) => patchNodeData({ fill: c })} />
          </Dropdown>
        ) : (
          <>
            {/* Standalone text: optional background turns it into a label/chip. */}
            <Dropdown
              openKey="fill"
              open={open}
              setOpen={setOpen}
              title="Background"
              icon={<span className="w-4 h-4 rounded-full border border-white/40" style={{ background: node.data?.fill || "transparent", borderStyle: node.data?.fill ? "solid" : "dashed" }} />}
            >
              <div>
                <Opt active={!node.data?.fill} onClick={() => { patchNodeData({ fill: null }); setOpen(null); }}>None</Opt>
                <SwatchGrid value={node.data?.fill} onPick={(c) => { patchNodeData({ fill: c }); setOpen(null); }} onLive={(c) => patchNodeData({ fill: c })} />
              </div>
            </Dropdown>
            {node.data?.fill && (
              <Dropdown
                openKey="box"
                open={open}
                setOpen={setOpen}
                title="Padding & corners"
                width={164}
                icon={<span className="w-4 h-4 border-2 border-white/70" style={{ borderRadius: 5 }} />}
              >
                <div className="p-1.5" style={{ width: 164 }}>
                  <div className="text-[10px] uppercase tracking-wide text-white/40 px-1 pb-1">Padding</div>
                  <div className="flex gap-1 px-0.5 pb-2">
                    {[["None", "none"], ["S", "sm"], ["M", "md"], ["L", "lg"]].map(([label, v]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => patchNodeData({ pad: v })}
                        className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                          (node.data?.pad || "md") === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                        }`}
                      >{label}</button>
                    ))}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-white/40 px-1 pb-1">Corners</div>
                  {[["Sharp", 0], ["Rounded", 8], ["Round", 16], ["Pill", 999]].map(([label, r]) => (
                    <Opt key={label} active={(node.data?.radius ?? 8) === r} onClick={() => patchNodeData({ radius: r })}>{label}</Opt>
                  ))}
                </div>
              </Dropdown>
            )}
          </>
        )}

        {isShape && (
          <Dropdown
            openKey="border"
            open={open}
            setOpen={setOpen}
            title="Border"
            icon={<span className="w-4 h-4 rounded-full border-2" style={{ borderColor: stroke }} />}
          >
            <div>
              <SwatchGrid value={stroke} onPick={(c) => { patchNodeData({ stroke: c }); setOpen(null); }} onLive={(c) => patchNodeData({ stroke: c })} />
              <div className="px-1.5 pb-1.5">
                <div className="text-[10px] uppercase tracking-wide text-white/40 px-0.5 pb-1">Width</div>
                <div className="flex gap-1 pb-2">
                  {[["Thin", 1.5], ["Med", 2], ["Thick", 3.5]].map(([label, w]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => patchNodeData({ strokeWidth: w })}
                      className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                        curStrokeWidth === w ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                      }`}
                    >{label}</button>
                  ))}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-white/40 px-0.5 pb-1">Style</div>
                <div className="flex gap-1">
                  {[["Solid", "solid"], ["Dashed", "dashed"], ["Dotted", "dotted"]].map(([label, v]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => patchNodeData({ strokeDash: v })}
                      className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                        curDash === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                      }`}
                    >{label}</button>
                  ))}
                </div>
              </div>
            </div>
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
            <div>
              <Opt active={!labelBg || labelBg === "none"} onClick={() => { patchNodeData({ labelBg: "none" }); setOpen(null); }}>Transparent</Opt>
              <Opt active={labelBg === "tint"} onClick={() => { patchNodeData({ labelBg: "tint" }); setOpen(null); }}>Frame colour</Opt>
              <SwatchGrid value={labelBg} onPick={(c) => { patchNodeData({ labelBg: c }); setOpen(null); }} onLive={(c) => patchNodeData({ labelBg: c })} />
            </div>
          </Dropdown>
        )}

        {hasPre && <ToolDivider />}

        <Dropdown
          openKey="text"
          open={open}
          setOpen={setOpen}
          title="Text size"
          width={132}
          icon={
            <span className="flex items-center gap-1">
              <span className="text-[13px] font-bold leading-none">Aa</span>
              <span className="text-[11px] text-white/70">{curFont}px</span>
            </span>
          }
        >
          <div className="py-1 nowheel" style={{ maxHeight: 240, overflowY: "auto" }}>
            {FONT_SIZES.map((f) => (
              <Opt key={f.v} active={curFont === f.v} onClick={() => { patchNodeData({ fontSize: f.v }); setOpen(null); }}>
                <span className="inline-flex items-baseline gap-2">
                  <span>{f.v}px</span>
                  {f.label && <span className="text-white/45 text-[11px]">{f.label}</span>}
                </span>
              </Opt>
            ))}
          </div>
        </Dropdown>

        {isTextable && (
          <>
            <button
              type="button"
              title="Bold (selection, or whole text)"
              onMouseDown={(e) => {
                e.preventDefault();
                if (!wrapActiveSelection("**")) patchNodeData({ text: toggleWholeMarkdown(node.data?.text, "**") });
              }}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/75 hover:bg-white/10"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Italic (selection, or whole text)"
              onMouseDown={(e) => {
                e.preventDefault();
                if (!wrapActiveSelection("_")) patchNodeData({ text: toggleWholeMarkdown(node.data?.text, "_") });
              }}
              className="h-7 w-7 rounded-md flex items-center justify-center text-white/75 hover:bg-white/10"
            >
              <Italic className="w-4 h-4" />
            </button>
          </>
        )}

        {isTextable && (
          <Dropdown
            openKey="textcolor"
            open={open}
            setOpen={setOpen}
            title="Text colour"
            icon={
              <span
                className="text-[13px] font-extrabold leading-none"
                style={{ color: curTextColor || "#fff", textShadow: curTextColor ? "0 0 2px rgba(0,0,0,.7)" : "none" }}
              >A</span>
            }
          >
            <div>
              <Opt active={!curTextColor} onClick={() => { patchNodeData({ textColor: null }); setOpen(null); }}>Auto (contrast)</Opt>
              <SwatchGrid value={curTextColor} onPick={(c) => { patchNodeData({ textColor: c }); setOpen(null); }} onLive={(c) => patchNodeData({ textColor: c })} />
            </div>
          </Dropdown>
        )}

        {isTextable && (
          <Dropdown
            openKey="align"
            open={open}
            setOpen={setOpen}
            title="Alignment"
            width={160}
            icon={<AlignCenter className="w-4 h-4" />}
          >
            <div className="p-1.5" style={{ width: 160 }}>
              <div className="text-[10px] uppercase tracking-wide text-white/40 px-1 pb-1">Horizontal</div>
              <div className="flex gap-1 px-0.5 pb-2">
                {[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]].map(([val, Icon]) => (
                  <button
                    key={val}
                    type="button"
                    title={val}
                    onClick={() => patchNodeData({ textAlign: val })}
                    className={`h-7 flex-1 rounded-md flex items-center justify-center transition-colors ${
                      curAlign === val ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              {(isSticky || isShape) && (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-white/40 px-1 pb-1">Vertical</div>
                  <div className="flex gap-1 px-0.5">
                    {[["top", "Top"], ["middle", "Mid"], ["bottom", "Bot"]].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => patchNodeData({ vAlign: val })}
                        className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                          curVAlign === val ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Dropdown>
        )}

        <ToolDivider />
        {/* Z-order: stacking of overlapping nodes. */}
        <button
          type="button"
          title="Bring to front"
          onClick={() => onReorder?.(true)}
          className="h-7 px-1.5 rounded-md flex items-center text-white/60 hover:bg-white/10 transition-colors"
        >
          <BringToFront className="w-4 h-4" />
        </button>
        <button
          type="button"
          title="Send to back"
          onClick={() => onReorder?.(false)}
          className="h-7 px-1.5 rounded-md flex items-center text-white/60 hover:bg-white/10 transition-colors"
        >
          <SendToBack className="w-4 h-4" />
        </button>
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
        <button
          type="button"
          title={locked ? "Locked — click to unlock" : "Lock position & size"}
          aria-pressed={locked}
          onClick={() => setLocked?.(!locked)}
          className={`h-7 px-1.5 rounded-md flex items-center transition-colors ${
            locked ? "text-[var(--color-accent)] bg-white/10" : "text-white/50 hover:bg-white/10"
          }`}
        >
          {locked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
        </button>
      </Pill>
    </div>
  );
}
