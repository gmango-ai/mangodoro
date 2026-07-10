import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Panel, useReactFlow } from "@xyflow/react";
import {
  Maximize,
  Type,
  Pencil,
  Paintbrush,
  Eraser,
  Wand2,
  ChevronDown,
} from "lucide-react";
import {
  SHAPES,
  preferredShape,
  setPreferredShape,
  ShapeSvg,
  preferredStickyColor,
  setPreferredStickyColor,
  STICKY_PALETTE,
  stickyHex,
} from "./nodes";
import TextPanel from "./TextPanel";
import {
  PEN_COLORS, PEN_WIDTHS,
  activeBrushSize, BRUSH_TEXTURES, BRUSH_SIZE_PRESETS,
} from "./wbStorage";
import {
  WB_TOUCH, TOOL_BTN_SIZE, TOOL_GROUP_CLS, CARET_CLS,
} from "./wbConstants";

// Toolbar icon button — themed tints per tool kind. `active` gives a filled
// look for toggle tools (e.g. the laser pointer mode).
// Lives in the top chrome card next to undo/redo (the editor sits inside a
// ReactFlowProvider, so useReactFlow works up here too).
export function FitViewButton({ dark }) {
  const rf = useReactFlow();
  return (
    <button
      type="button"
      onClick={() => rf.fitView({ padding: 0.2, duration: 300 })}
      title="Fit view"
      aria-label="Fit view"
      className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
        dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      <Maximize className="w-4 h-4" />
    </button>
  );
}

// Group separator in the bottom toolbar. Shown on every size (it keeps the
// scrolling rail readable by chunking related tools) with a little breathing
// room on either side.
export function ToolbarDivider({ dark }) {
  return (
    <div className={`w-px h-6 self-center shrink-0 mx-1 sm:mx-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
  );
}

export function ToolButton({ title, onClick, tone = "neutral", dark, active, children }) {
  const tones = {
    neutral: dark
      ? "text-slate-300 hover:bg-white/10"
      : "text-slate-600 hover:bg-slate-100",
    amber: dark
      ? "text-amber-400 hover:bg-amber-500/15"
      : "text-amber-600 hover:bg-amber-50",
    sky: dark
      ? "text-sky-400 hover:bg-sky-500/15"
      : "text-sky-600 hover:bg-sky-50",
    red: dark
      ? "text-red-400 hover:bg-red-500/15"
      : "text-red-500 hover:bg-red-50",
  };
  const activeCls = dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors ${active ? activeCls : tones[tone]}`}
    >
      {children}
    </button>
  );
}

// Mini outline preview of a shape, for the picker + inspector.
export function ShapePreview({ shape, w = 26, h = 18 }) {
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
    >
      <ShapeSvg
        shape={shape}
        w={w}
        h={h}
        fill="none"
        stroke="currentColor"
        sw={1.5}
      />
    </svg>
  );
}

// Toolbar dropdown of the full flowchart shape catalogue.
export function ShapesMenu({ dark, onPick, onDropAt }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() => preferredShape());
  const [ghost, setGhost] = useState(null); // {x,y,shape} while dragging from a button
  const dragRef = useRef(null);
  const chooseAndAdd = (key) => { setPreferredShape(key); setCurrent(key); onPick(key); setOpen(false); };

  // Drag off any shape button to drop it where you release (with a live ghost);
  // a plain click keeps the old behaviour (add at centre / choose). Pointer
  // capture keeps the events on the button so the canvas doesn't pan.
  const startDrag = (shape) => (e) => {
    if (e.button != null && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    dragRef.current = { moved: false, sx: e.clientX, sy: e.clientY, shape };
  };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setGhost({ x: e.clientX, y: e.clientY, shape: d.shape });
  };
  const endDrag = (onClick) => (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (d?.moved) {
      setPreferredShape(d.shape);
      setCurrent(d.shape);
      onDropAt?.(e.clientX, e.clientY, d.shape);
      setOpen(false);
    } else onClick?.();
  };

  return (
    <div className={TOOL_GROUP_CLS}>
      {/* One click drops the last-used shape (no dropdown) so you can chain a
          flowchart fast; drag to place it exactly; the caret opens the full
          catalogue + remembers it. */}
      <button
        type="button"
        title="Add shape (last used) — click, or drag to place · caret to choose another"
        onPointerDown={startDrag(current)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag(() => onPick(current))}
        className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors touch-none cursor-grab active:cursor-grabbing ${
          dark
            ? "text-sky-400 hover:bg-sky-500/15"
            : "text-sky-600 hover:bg-sky-50"
        }`}
      >
        <ShapePreview shape={current} w={18} h={14} />
      </button>
      <button
        type="button"
        title="Choose shape"
        aria-label="Choose shape"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${CARET_CLS} ${
          dark
            ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]"
            : "bg-white text-slate-500 border border-slate-200"
        }`}
      >
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <MaybeFlyoutPortal>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute bottom-11 left-1/2 -translate-x-1/2 z-20 p-2 rounded-2xl border shadow-lg grid grid-cols-5 gap-1 ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                : "bg-white border-slate-200"
            }`}
            style={{ width: 220 }}
          >
            {SHAPES.map((s) => (
              <button
                key={s.key}
                type="button"
                title={`${s.label} — click, or drag to place`}
                onPointerDown={startDrag(s.key)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag(() => chooseAndAdd(s.key))}
                className={`h-10 rounded-lg flex items-center justify-center touch-none cursor-grab active:cursor-grabbing ${
                  s.key === current
                    ? "bg-sky-500/20 text-sky-500"
                    : dark
                      ? "text-slate-300 hover:bg-white/10"
                      : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <ShapePreview shape={s.key} />
              </button>
            ))}
          </div>
          </MaybeFlyoutPortal>
        </>
      )}
      {ghost && createPortal(
        <div
          aria-hidden
          style={{
            position: "fixed", left: ghost.x, top: ghost.y,
            transform: "translate(-50%,-50%)", pointerEvents: "none",
            zIndex: 9999, opacity: 0.92, color: dark ? "#38bdf8" : "#0284c7",
          }}
        >
          <svg width="60" height="40" viewBox="0 0 60 40" style={{ display: "block", filter: "drop-shadow(0 6px 16px rgba(0,0,0,.28))" }}>
            <ShapeSvg shape={ghost.shape} w={60} h={40} fill={dark ? "#0b1220" : "#ffffff"} stroke="currentColor" sw={2} />
          </svg>
        </div>,
        document.body
      )}
    </div>
  );
}

// Corner caret shared by the rail tools — toggles the options flyout.
export function ToolChevron({ label, open, setOpen, dark }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={`${CARET_CLS} ${
        WB_TOUCH
          ? open
            ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
            : dark ? "text-slate-400" : "text-slate-500"
          : dark
            ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]"
            : "bg-white text-slate-500 border border-slate-200"
      }`}
    >
      <ChevronDown className={WB_TOUCH ? "w-4 h-4" : "w-2.5 h-2.5"} />
    </button>
  );
}

// Light-styled options flyout (backdrop + panel) shared by the rail tools.
export function ToolPopover({ dark, onClose, children }) {
  return (
    <MaybeFlyoutPortal>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={`absolute bottom-11 left-1/2 -translate-x-1/2 z-20 p-2.5 rounded-2xl border shadow-lg ${
          dark
            ? "bg-[var(--color-surface)] border-[var(--color-border)]"
            : "bg-white border-slate-200"
        }`}
        style={{ width: 188 }}
      >
        {children}
      </div>
    </MaybeFlyoutPortal>
  );
}

// 6-across swatch grid shared by the sticky / pen / laser flyouts.
export function PaletteGrid({ colors, selected, onPick }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {colors.map((hex) => (
        <button
          key={hex}
          type="button"
          title={hex}
          onClick={() => onPick(hex)}
          className="w-6 h-6 rounded-md transition-transform hover:scale-110"
          style={{
            background: hex,
            outline:
              selected.toLowerCase() === hex.toLowerCase()
                ? "2px solid #f97316"
                : "none",
            outlineOffset: 1,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
          }}
        />
      ))}
    </div>
  );
}

// Procreate-style colour control: a single swatch button showing the current
// colour that opens a palette + custom-picker popover (replaces a cramped inline
// swatch row). Shared by the paint toolbar.
export function ColorButton({ dark, color, palette, onPick }) {
  const [open, setOpen] = useState(false);
  const safe = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0ea5e9";
  // Routes through ToolPopover like every other rail flyout, so the popover
  // portals above the trigger and escapes the toolbar's overflow clipping
  // (which used to mask it out on desktop). "All popovers handled the same."
  return (
    <div className="flex items-center">
      <button
        type="button"
        title="Colour"
        aria-label="Colour"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${WB_TOUCH ? "w-9 h-9" : "w-7 h-7"} rounded-full shrink-0 border-2 transition-transform active:scale-95 ${
          dark ? "border-white/25" : "border-black/10"
        }`}
        style={{ background: safe, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }}
      />
      {open && (
        <ToolPopover dark={dark} onClose={() => setOpen(false)}>
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Colour
          </div>
          <PaletteGrid colors={palette} selected={color} onPick={(hex) => { onPick(hex); setOpen(false); }} />
          <label className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
            <input
              type="color"
              value={safe}
              onChange={(e) => onPick(e.target.value)}
              style={{ width: 26, height: 26, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
            Custom colour
          </label>
        </ToolPopover>
      )}
    </div>
  );
}

// Sticky tool for the rail. The button shows the current default color
// and adds a note in it; the corner caret opens a palette flyout to
// change the default (curated pastels + any custom hex). Picking a color
// sets it as the default AND drops a note in that color.
export function StickyTool({ dark, onAdd, onDropAt }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() =>
    stickyHex(preferredStickyColor())
  );
  const [ghost, setGhost] = useState(null); // {x,y} while dragging from the button
  const dragRef = useRef(null);

  // Choosing a color only sets the DEFAULT — it no longer drops a note (you were
  // getting a sticky the instant you touched the custom-color picker). Place a
  // note by clicking the button or dragging from it. Presets close the flyout;
  // the custom picker stays open so you can fine-tune before placing.
  function setDefaultColor(hex) {
    setPreferredStickyColor(hex);
    setCurrent(stickyHex(hex));
  }
  function pickPreset(hex) {
    setDefaultColor(hex);
    setOpen(false);
  }

  // Drag off the button to drop a sticky where you release (with a ghost
  // preview); a plain click (no drag) drops one at the visible center. Pointer
  // capture keeps the events on the button so the canvas doesn't pan.
  const onBtnPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    dragRef.current = { moved: false, sx: e.clientX, sy: e.clientY };
  };
  const onBtnPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setGhost({ x: e.clientX, y: e.clientY });
  };
  const onBtnPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (d?.moved) onDropAt?.(e.clientX, e.clientY, current);
    else onAdd();
  };

  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title="Add sticky note — or drag to place"
        aria-label="Add sticky note"
        onPointerDown={onBtnPointerDown}
        onPointerMove={onBtnPointerMove}
        onPointerUp={onBtnPointerUp}
        className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors touch-none cursor-grab active:cursor-grabbing ${
          dark ? "hover:bg-white/10" : "hover:bg-slate-100"
        }`}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: current,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.18)",
          }}
        />
      </button>
      <ToolChevron label="Choose sticky color" open={open} setOpen={setOpen} dark={dark} />
      {open && (
        <ToolPopover dark={dark} onClose={() => setOpen(false)}>
          <div
            className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              Sticky color
            </div>
            <div className="grid grid-cols-6 gap-1">
              {STICKY_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => pickPreset(hex)}
                  className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                  style={{
                    background: hex,
                    outline:
                      current.toLowerCase() === hex.toLowerCase()
                        ? "2px solid #f97316"
                        : "none",
                    outlineOffset: 1,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
                  }}
                />
              ))}
            </div>
            <label
              className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${
                dark ? "text-slate-300" : "text-slate-600"
              }`}
            >
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : "#fde68a"}
                onChange={(e) => setDefaultColor(e.target.value)}
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                }}
              />
              Custom color
            </label>
          </div>
        </ToolPopover>
      )}
      {ghost && createPortal(
        <div
          aria-hidden
          style={{
            position: "fixed", left: ghost.x, top: ghost.y,
            transform: "translate(-50%,-50%) rotate(-4deg)",
            width: 40, height: 40, borderRadius: 6, background: current,
            boxShadow: "0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(0,0,0,.12)",
            pointerEvents: "none", zIndex: 9999, opacity: 0.92,
          }}
        />,
        document.body
      )}
    </div>
  );
}

// "Add text" tool — mirrors StickyTool. The button adds a text node seeded with
// the saved defaults; the chevron opens the merged text options (font / size /
// align / colour) that edit those defaults. Dark panel to match TextPanel.
export function TextTool({ onAdd, prefs, setPrefs, dark }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title="Add text"
        aria-label="Add text"
        onClick={() => onAdd()}
        className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors ${
          dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Type className="w-4 h-4" />
      </button>
      <ToolChevron label="New-text defaults" open={open} setOpen={setOpen} dark={dark} />
      {open && (
        <>
          <MaybeFlyoutPortal>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-11 left-1/2 -translate-x-1/2 z-20 rounded-xl shadow-2xl overflow-hidden"
            style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.1)" }}
          >
            <div className="px-2.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-white/40">
              New-text defaults
            </div>
            <TextPanel
              node={{ type: "text", data: prefs }}
              patchNodeData={(patch) => setPrefs({ ...prefs, ...patch })}
              forDefaults
            />
          </div>
          </MaybeFlyoutPortal>
        </>
      )}
    </div>
  );
}

// Freehand pen tool for the rail: the button toggles draw mode; the chevron
// opens colour + width options (mirrors StickyTool / TextTool). Strokes commit
// as draw nodes (see DrawNode), so they persist, sync and undo like anything.
export function PenTool({ dark, active, style, setStyle, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title={active ? "Pen (on) — Esc to exit" : "Pen — draw freehand"}
        aria-label="Pen"
        aria-pressed={active}
        onClick={onToggle}
        className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors ${
          active
            ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
            : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Pencil className="w-4 h-4" />
      </button>
      <ToolChevron label="Pen options" open={open} setOpen={setOpen} dark={dark} />
      {open && (
        <ToolPopover dark={dark} onClose={() => setOpen(false)}>
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Pen colour
          </div>
          <PaletteGrid
            colors={PEN_COLORS}
            selected={style.color}
            onPick={(hex) => setStyle((s) => ({ ...s, color: hex }))}
          />
          <label className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(style.color) ? style.color : "#0f172a"}
              onChange={(e) => setStyle((s) => ({ ...s, color: e.target.value }))}
              style={{ width: 24, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
            Custom colour
          </label>
          <div className={`text-[10px] font-bold uppercase tracking-wide mt-2.5 mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Width
          </div>
          <div className="flex gap-1">
            {PEN_WIDTHS.map(([label, w]) => (
              <button
                key={w}
                type="button"
                onClick={() => setStyle((s) => ({ ...s, width: w }))}
                className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                  style.width === w
                    ? dark ? "bg-white/15 text-white" : "bg-slate-200 text-slate-700"
                    : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
                }`}
              >{label}</button>
            ))}
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-wide mt-2.5 mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Opacity
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round((style.opacity ?? 1) * 100)}
              onChange={(e) => setStyle((s) => ({ ...s, opacity: Number(e.target.value) / 100 }))}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className={`text-[11px] tabular-nums w-8 text-right ${dark ? "text-slate-300" : "text-slate-600"}`}>{Math.round((style.opacity ?? 1) * 100)}%</span>
          </div>
          <label className={`mt-2.5 flex items-center justify-between gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
            <span>Pressure (Apple Pencil)</span>
            <input
              type="checkbox"
              checked={style.pressure ?? true}
              onChange={(e) => setStyle((s) => ({ ...s, pressure: e.target.checked }))}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
          </label>
        </ToolPopover>
      )}
    </div>
  );
}

// Laser pointer tool for the rail: toggles laser mode; the chevron opens a
// colour picker for your laser dot + ink (shared to peers in that colour).
export function LaserTool({ dark, active, color, setColor, onToggle }) {
  const [open, setOpen] = useState(false);
  const cur = color || "#ef4444";
  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title={active ? "Laser (on) — drag to draw a fading line, ⌘/Ctrl-drag to pan, Esc to exit" : "Laser pointer — point things out & underline"}
        aria-label="Laser pointer"
        aria-pressed={active}
        onClick={onToggle}
        className={`${TOOL_BTN_SIZE} shrink-0 rounded-full flex items-center justify-center transition-colors ${
          active
            ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
            : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Wand2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Laser colour"
        aria-label="Laser colour"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={WB_TOUCH ? "w-7 h-11 -ml-1.5 rounded-xl border-2" : "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full shadow border-2"}
        style={{ background: cur, borderColor: dark ? "var(--color-surface)" : "#fff" }}
      />
      {open && (
        <ToolPopover dark={dark} onClose={() => setOpen(false)}>
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>Laser colour</div>
          <PaletteGrid
            colors={PEN_COLORS.filter((c) => c !== "#ffffff")}
            selected={cur}
            onPick={setColor}
          />
          <label className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(cur) ? cur : "#ef4444"}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 24, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
            Custom colour
          </label>
        </ToolPopover>
      )}
    </div>
  );
}

// Fuller palette for the ColorButton popover (3 rows of 6).
export const BRUSH_PALETTE = [
  "#0f172a", "#64748b", "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#ffffff",
];

// Hosts a tool flyout. The toolbars use overflow-x-auto (which also clips
// overflow-y), so an inline absolute flyout gets masked out. Instead we ALWAYS
// portal to <body> into a 0-size fixed anchor placed at the trigger's top-centre
// — the flyout's own `absolute bottom-11 left-1/2` then renders it above the
// trigger, unclipped, identically on desktop and touch.
export function MaybeFlyoutPortal({ children }) {
  const anchorRef = useRef(null);
  const wrapRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [dx, setDx] = useState(0); // horizontal nudge to keep it on-screen
  // First pass: place a 0-size anchor at the trigger's BOTTOM-centre, so the
  // flyout's own `bottom-11` renders it a tight gap above the toolbar (anchoring
  // at the top would stack that gap on the trigger's height → floats too high).
  useLayoutEffect(() => {
    const wrap = anchorRef.current?.parentElement; // the tool's wrapper
    const r = wrap?.getBoundingClientRect();
    if (r) setPos({ left: r.left + r.width / 2, top: r.bottom });
  }, []);
  // Second pass: measure the (centred) flyout and clamp it inside the viewport
  // so a trigger near an edge doesn't push the popover off-screen. The popover
  // is the last child (every call site renders the backdrop first).
  useLayoutEffect(() => {
    if (!pos || !wrapRef.current) return;
    const pop = wrapRef.current.lastElementChild;
    const r = pop?.getBoundingClientRect();
    if (!r) return;
    const m = 8;
    let shift = 0;
    if (r.left < m) shift = m - r.left;
    else if (r.right > window.innerWidth - m) shift = window.innerWidth - m - r.right;
    if (shift) setDx((d) => d + shift);
  }, [pos]);
  return (
    <>
      <span ref={anchorRef} aria-hidden style={{ position: "absolute", width: 0, height: 0 }} />
      {pos && createPortal(
        <div ref={wrapRef} className="fixed z-[80]" style={{ left: pos.left + dx, top: pos.top }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function PaintToolbar({ dark, style, setStyle, bottomOffset = 64 }) {
  const divider = <div className={`w-px h-6 mx-0.5 ${dark ? "bg-white/10" : "bg-slate-200"}`} />;
  const labelCls = `text-[10px] font-bold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`;
  const numCls = `text-[11px] tabular-nums ${dark ? "text-slate-300" : "text-slate-600"}`;
  const touch = WB_TOUCH;
  // Brush + eraser carry independent sizes; edit whichever mode is active.
  const curSize = activeBrushSize(style);
  const setSize = (n) => setStyle((s) => (s.erase ? { ...s, eraseSize: n } : { ...s, size: n }));
  const seg = (on, onClick, title, Icon) => (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`${touch ? "h-10 px-3" : "h-8 px-2.5"} rounded-lg flex items-center transition-colors ${
        on
          ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
          : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
  const chip = (label, active, onClick, { title, disabled, wide } = {}) => (
    <button
      key={label}
      type="button"
      title={title || label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`${touch ? "h-9" : "h-7"} ${wide ? "px-2.5" : touch ? "w-9" : "w-7"} rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40 shrink-0 ${
        active
          ? dark ? "bg-white/15 text-white" : "bg-slate-200 text-slate-700"
          : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
      }`}
    >{label}</button>
  );
  return (
    <Panel
      position="bottom-left"
      // Stacked ABOVE the main (bottom-left) toolbar; the offset tracks the
      // toolbar's measured height so a wrapped (two-row) toolbar still clears.
      style={{ bottom: bottomOffset }}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-2xl border shadow-lg max-w-[calc(100%-16px)] overflow-x-auto ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      {seg(!style.erase, () => setStyle((s) => ({ ...s, erase: false })), "Brush", Paintbrush)}
      {seg(style.erase, () => setStyle((s) => ({ ...s, erase: true })), "Eraser", Eraser)}
      {divider}
      <ColorButton
        dark={dark}
        color={style.color}
        palette={BRUSH_PALETTE}
        onPick={(hex) => setStyle((s) => ({ ...s, color: hex, erase: false }))}
      />
      {divider}
      {/* Brush texture — eraser is always smooth, so it's disabled there. */}
      <div className="flex items-center gap-0.5 shrink-0">
        {BRUSH_TEXTURES.map(([label, key]) =>
          chip(label, !style.erase && style.texture === key, () => setStyle((s) => ({ ...s, texture: key })), {
            title: `${label} brush`, disabled: style.erase, wide: true,
          }),
        )}
      </div>
      {divider}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={labelCls}>Size</span>
        <div className="flex items-center gap-0.5">
          {BRUSH_SIZE_PRESETS.map(([label, n]) => chip(label, curSize === n, () => setSize(n), { title: `${label} — ${n}px` }))}
        </div>
        <input
          type="range"
          min={1}
          max={120}
          step={1}
          value={curSize}
          onChange={(e) => setSize(Number(e.target.value))}
          className={`${touch ? "w-20" : "w-24"} accent-[var(--color-accent)]`}
        />
        <span className={`${numCls} w-6 text-right`}>{curSize}</span>
      </div>
      {divider}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={labelCls}>Opacity</span>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(style.opacity * 100)}
          disabled={style.erase}
          onChange={(e) => setStyle((s) => ({ ...s, opacity: Number(e.target.value) / 100 }))}
          className="w-20 accent-[var(--color-accent)] disabled:opacity-40"
        />
        <span className={`${numCls} w-8 text-right`}>{Math.round(style.opacity * 100)}%</span>
      </div>
    </Panel>
  );
}
