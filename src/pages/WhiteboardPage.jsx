import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Panel,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  useReactFlow,
  MarkerType,
  ConnectionMode,
  SelectionMode,
  NodeToolbar,
  Position,
  getNodesBounds,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Maximize,
  Target,
  Pencil,
  Archive,
  Download,
  Crop,
  Type,
  Frame,
  ImagePlus,
  Trash2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  StretchHorizontal,
  StretchVertical,
  ChevronDown,
  Smile,
  Timer,
  Undo2,
  Redo2,
  Map as MapIcon,
  LayoutTemplate,
  Wand2,
  Paintbrush,
  Eraser,
  MessageSquare,
  MoreHorizontal,
  StickyNote,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "../components/Skeleton";
import {
  fetchWhiteboardById,
  saveSnapshot,
  setWhiteboardGoal,
  setWhiteboardTitle,
  archiveWhiteboard,
  TEMPLATES,
  templateSnapshotFor,
  isEmptySnapshot,
} from "../lib/whiteboard";
import {
  NODE_TYPES,
  SHAPES,
  preferredShape,
  setPreferredShape,
  QuickConnectContext,
  ShapeSvg,
  preferredStickyColor,
  setPreferredStickyColor,
  STICKY_PALETTE,
  stickyHex,
  markNodeForEdit,
  strokePath,
} from "../components/whiteboard/nodes";
import {
  nodeAbsPos,
  sortParentsFirst,
  frameAt,
  declampNodes,
} from "../components/whiteboard/frame";
import { useApp } from "../context/AppContext";
import {
  EDGE_TYPES,
  ConnectShapeContext,
  EdgeMarkerDefs,
  ConnectionLine,
  connectedNodePlacement,
  siblingPlacement,
  nodeRect,
  snappedAnchor,
  SIDE_POS,
  ANCHOR_TO_HANDLE,
  NON_CONNECTABLE,
} from "../components/whiteboard/edges";
import { useWhiteboardSync } from "../components/whiteboard/useWhiteboardSync";
import { useWhiteboardHistory } from "../components/whiteboard/useWhiteboardHistory";
import { uploadWhiteboardImage } from "../lib/whiteboardImage";
import { ensureGoogleFont } from "../lib/whiteboardFonts";
import TextPanel from "../components/whiteboard/TextPanel";
import {
  snapToGrid,
  nodeSnaps,
  getAlignmentGuides,
  getResizeGuides,
  alignDistance,
  HelperLines,
} from "../components/whiteboard/snapping";
import {
  CollabCursors,
  PresenceStack,
  LocalLaser,
  LaserTrail,
  BrushCursor,
} from "../components/whiteboard/CollabCursors";
import Inspector from "../components/whiteboard/Inspector";
import { DropUpContext } from "../components/whiteboard/toolbarUI";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import PaintLayer from "../components/whiteboard/PaintLayer";
import SaveTemplateModal from "../components/whiteboard/SaveTemplateModal";
import EmoteOverlay from "../components/emotes/EmoteOverlay";
import WhiteboardTimer from "../components/whiteboard/WhiteboardTimer";

const SAVE_DEBOUNCE_MS = 1200;

// Default node sizes used by the toolbar's "+ Sticky / + Text / + Rect
// / + Ellipse" buttons. We keep them small so they fit visually inside
// template zones without overflowing.
const DEFAULTS = {
  sticky: { w: 144, h: 144 },
  text: { w: 220, h: 60 },
  rect: { w: 180, h: 100 },
  ellipse: { w: 180, h: 110 },
  diamond: { w: 150, h: 110 },
  shape: { w: 180, h: 100 },
  goal: { w: 240, h: 150 },
  frame: { w: 600, h: 840 },
  image: { w: 240, h: 180 },
};

const DEFAULT_EDGE_OPTIONS = {
  type: "editable",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#0ea5e9" },
  style: { stroke: "#0ea5e9", strokeWidth: 2 },
};

const NO_LINES = { vertical: null, horizontal: null }; // stable empty guide state

// Map a grabbed handle (by id or position) back to the SOURCE handle on
// that side, so a drag-created edge leaves from the side you pulled from.
// Each side carries both a source ("t"/"r"/"b"/"l") and target
// ("tt"/"rt"/"bt"/"lt") handle.
const SIDE_FROM_ID = {
  t: "t",
  tt: "t",
  r: "r",
  rt: "r",
  b: "b",
  bt: "b",
  l: "l",
  lt: "l",
};
const SIDE_FROM_POS = { top: "t", right: "r", bottom: "b", left: "l" };
// Fallback entry side: opposite the side the edge left the source from.
const OPPOSITE_TARGET = { t: "b", r: "l", b: "t", l: "r" };

// Toolbar icon button — themed tints per tool kind. `active` gives a filled
// look for toggle tools (e.g. the laser pointer mode).
// Lives in the top chrome card next to undo/redo (the editor sits inside a
// ReactFlowProvider, so useReactFlow works up here too).
function FitViewButton({ dark }) {
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

function ToolButton({ title, onClick, tone = "neutral", dark, active, children }) {
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
      className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors ${active ? activeCls : tones[tone]}`}
    >
      {children}
    </button>
  );
}

// Mini outline preview of a shape, for the picker + inspector.
function ShapePreview({ shape, w = 26, h = 18 }) {
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
function ShapesMenu({ dark, onPick, onDropAt }) {
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
        className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors touch-none cursor-grab active:cursor-grabbing ${
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
function ToolChevron({ label, open, setOpen, dark }) {
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
function ToolPopover({ dark, onClose, children }) {
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
function PaletteGrid({ colors, selected, onPick }) {
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

// Sticky tool for the rail. The button shows the current default color
// and adds a note in it; the corner caret opens a palette flyout to
// change the default (curated pastels + any custom hex). Picking a color
// sets it as the default AND drops a note in that color.
function StickyTool({ dark, onAdd, onDropAt }) {
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
        className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors touch-none cursor-grab active:cursor-grabbing ${
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
function TextTool({ onAdd, prefs, setPrefs, dark }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title="Add text"
        aria-label="Add text"
        onClick={() => onAdd()}
        className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors ${
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
function PenTool({ dark, active, style, setStyle, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={TOOL_GROUP_CLS}>
      <button
        type="button"
        title={active ? "Pen (on) — Esc to exit" : "Pen — draw freehand"}
        aria-label="Pen"
        aria-pressed={active}
        onClick={onToggle}
        className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors ${
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
        </ToolPopover>
      )}
    </div>
  );
}

// Laser pointer tool for the rail: toggles laser mode; the chevron opens a
// colour picker for your laser dot + ink (shared to peers in that colour).
function LaserTool({ dark, active, color, setColor, onToggle }) {
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
        className={`${TOOL_BTN_SIZE} rounded-full flex items-center justify-center transition-colors ${
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

// Quick colours for the paint toolbar (a curated row; the well covers the rest).
const PAINT_QUICK_COLORS = [
  "#0f172a", "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#ffffff",
];

// Floating toolbar shown while the brush is active — brush/eraser, colour, size
// and opacity in one place (room to grow: brush types, smoothing, etc.).
// 44px tool targets on touch (Apple HIG); compact 32px with a mouse.
const WB_TOUCH =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const TOOL_BTN_SIZE = WB_TOUCH ? "w-11 h-11" : "w-8 h-8";
// Tool + its options caret read as one grouped row on touch.
const TOOL_GROUP_CLS = WB_TOUCH ? "relative flex items-center" : "relative";
const BOTTOM_PANEL_GAP = 8;
const PAINT_TOOLBAR_STACK_H = 54;
const TOUCH_INSPECTOR_FALLBACK_H = 54;

// Touch: the 14px corner caret is untappable — full-height chevron grouped
// beside the tool instead.
const CARET_CLS = WB_TOUCH
  ? "w-7 h-11 -ml-1.5 rounded-full flex items-center justify-center"
  : "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow";

// Hosts a tool flyout. Desktop: anchored above its trigger (absolute inside
// the tool's relative wrapper). Touch: the toolbar scrolls horizontally and
// would clip it — portal to <body>, centered above the bar (clearance kept
// in --wb-toolbar-clear by the toolbar measurer; -44px compensates the
// child's own bottom-11 anchor).
function MaybeFlyoutPortal({ children }) {
  if (!WB_TOUCH) return <>{children}</>;
  return createPortal(
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[80]"
      style={{ bottom: "calc(var(--bottom-inset, 0px) + var(--wb-toolbar-clear, 64px) - 44px)" }}
    >
      {children}
    </div>,
    document.body,
  );
}

function PaintToolbar({ dark, style, setStyle, bottomOffset = 64 }) {
  const divider = <div className={`w-px h-6 mx-0.5 ${dark ? "bg-white/10" : "bg-slate-200"}`} />;
  const labelCls = `text-[10px] font-bold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`;
  const numCls = `text-[11px] tabular-nums ${dark ? "text-slate-300" : "text-slate-600"}`;
  const seg = (on, onClick, title, Icon) => (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`h-8 px-2.5 rounded-lg flex items-center transition-colors ${
        on
          ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
          : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
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
      <div className="flex items-center gap-1">
        {PAINT_QUICK_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            title={hex}
            onClick={() => setStyle((s) => ({ ...s, color: hex, erase: false }))}
            className="w-5 h-5 rounded-md transition-transform hover:scale-110 shrink-0"
            style={{
              background: hex,
              outline: !style.erase && style.color.toLowerCase() === hex.toLowerCase() ? "2px solid #f97316" : "none",
              outlineOffset: 1,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)",
            }}
          />
        ))}
        <input
          type="color"
          title="Custom colour"
          value={/^#[0-9a-fA-F]{6}$/.test(style.color) ? style.color : "#0ea5e9"}
          onChange={(e) => setStyle((s) => ({ ...s, color: e.target.value, erase: false }))}
          style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
        />
      </div>
      {divider}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={labelCls}>Size</span>
        <input
          type="range"
          min={1}
          max={120}
          step={1}
          value={style.size}
          onChange={(e) => setStyle((s) => ({ ...s, size: Number(e.target.value) }))}
          className="w-24 accent-[var(--color-accent)]"
        />
        <span className={`${numCls} w-6 text-right`}>{style.size}</span>
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

// Dot-voting: a tally badge floating above each node's top-right corner. Shown
// on any node that has votes, plus the selected node (as a "vote" affordance so
// you can cast the first one). Votes are a per-user map in node.data.votes
// (`{ userId: 1 }`), so they sync + persist like any node data and each person
// can add/remove only their own. One overlay covers every node type.
function VotesOverlay({ nodes, myId, onToggle, dark }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const show = nodes.filter(
    (n) => n.type !== "zone" && n.type !== "frame" &&
      (n.selected || (n.data?.votes && Object.keys(n.data.votes).length))
  );
  if (!show.length) return null;
  return (
    <ViewportPortal>
      {show.map((n) => {
        const abs = nodeAbsPos(n, byId);
        const w = n.width || n.measured?.width || 0;
        const votes = n.data?.votes || {};
        const count = Object.keys(votes).length;
        const mine = !!(myId && votes[myId]);
        return (
          <div
            key={`vote-${n.id}`}
            // Just OUTSIDE the right edge near the top — clear of the Inspector
            // (above) and the corner resize handles. pointerEvents:auto opts back
            // in (the viewport-portal layer is none, so clicks pass through it).
            style={{ position: "absolute", left: abs.x + w + 8, top: abs.y + 2, zIndex: 30, pointerEvents: "auto" }}
          >
            <button
              type="button"
              className="nodrag"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggle(n.id); }}
              title={count ? `${count} vote${count === 1 ? "" : "s"} — click to ${mine ? "remove" : "add"} yours` : "Vote"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 12, fontWeight: 800, lineHeight: 1,
                padding: "3px 8px", borderRadius: 9999, cursor: "pointer",
                background: mine ? "var(--color-accent)" : dark ? "rgba(15,23,42,.86)" : "#fff",
                color: mine ? "#fff" : dark ? "#e2e8f0" : "#334155",
                border: `1.5px solid ${mine ? "var(--color-accent)" : dark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.12)"}`,
                boxShadow: "0 4px 10px -4px rgba(0,0,0,.4)",
                opacity: count === 0 && !mine ? 0.7 : 1,
              }}
            >
              <span style={{ fontSize: 13 }}>👍</span>
              {count > 0 && <span>{count}</span>}
            </button>
          </div>
        );
      })}
    </ViewportPortal>
  );
}

// Short relative timestamp for comments ("just now" / "5m" / "2h" / "3d").
function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Comment indicator badges (top-left of each node), mirroring the vote badges.
// Shown on any node with comments + the selected node (to start a thread).
// Clicking toggles the thread open for that node. Comments live in
// data.comments so they sync + persist like any node data.
function CommentsOverlay({ nodes, openId, onOpen, dark }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const show = nodes.filter(
    (n) => n.type !== "zone" && n.type !== "frame" &&
      (n.selected || (n.data?.comments && n.data.comments.length))
  );
  if (!show.length) return null;
  return (
    <ViewportPortal>
      {show.map((n) => {
        const abs = nodeAbsPos(n, byId);
        const count = n.data?.comments?.length || 0;
        const open = openId === n.id;
        const lit = open || count > 0;
        return (
          <div
            key={`cmt-${n.id}`}
            // Just OUTSIDE the left edge near the top — clear of the Inspector
            // (above) and the corner resize handles. pointerEvents:auto opts back
            // in (the viewport-portal layer is none, so clicks pass through it).
            style={{ position: "absolute", left: abs.x - 8, top: abs.y + 2, transform: "translate(-100%,0)", zIndex: 30, pointerEvents: "auto" }}
          >
            <button
              type="button"
              className="nodrag wb-comment-badge"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpen(open ? null : n.id); }}
              title={count ? `${count} comment${count === 1 ? "" : "s"}` : "Comment"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 12, fontWeight: 800, lineHeight: 1,
                padding: "3px 8px", borderRadius: 9999, cursor: "pointer",
                background: open ? "var(--color-accent)" : dark ? "rgba(15,23,42,.86)" : "#fff",
                color: open ? "#fff" : lit ? (dark ? "#e2e8f0" : "#334155") : "#94a3b8",
                border: `1.5px solid ${open ? "var(--color-accent)" : dark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.12)"}`,
                boxShadow: "0 4px 10px -4px rgba(0,0,0,.4)",
                opacity: lit ? 1 : 0.7,
              }}
            >
              <MessageSquare style={{ width: 13, height: 13 }} />
              {count > 0 && <span>{count}</span>}
            </button>
          </div>
        );
      })}
    </ViewportPortal>
  );
}

// Thread popover (rendered in a NodeToolbar anchored to the node): the comment
// list + an input. You can delete your own comments. Enter sends, Shift+Enter
// newlines.
function CommentThread({ comments, myId, onAdd, onDelete, onClose, dark }) {
  const [text, setText] = useState("");
  const submit = () => { const t = text.trim(); if (!t) return; onAdd(t); setText(""); };
  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";
  const txt = dark ? "#e2e8f0" : "#334155";
  const muted = "#94a3b8";
  return (
    <div
      className="nodrag nowheel wb-comment-thread"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ width: 264, background: surface, border: `1px solid ${border}`, borderRadius: 14, boxShadow: "0 18px 40px -16px rgba(0,0,0,.5)", overflow: "hidden", color: txt }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 12, fontWeight: 800 }}>Comments</span>
        <button type="button" onClick={onClose} title="Close" style={{ display: "flex", color: muted }}><X style={{ width: 14, height: 14 }} /></button>
      </div>
      <div style={{ maxHeight: 240, overflowY: "auto", padding: comments.length ? "4px 10px" : 0 }}>
        {comments.length === 0 && <div style={{ padding: "14px 10px", fontSize: 12, color: muted }}>No comments yet — start the thread.</div>}
        {comments.map((c) => (
          <div key={c.id} style={{ padding: "6px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{c.author || "Guest"}</span>
              <span style={{ fontSize: 10, color: muted }}>{timeAgo(c.ts)}</span>
              {c.authorId && c.authorId === myId && (
                <button type="button" onClick={() => onDelete(c.id)} title="Delete" style={{ marginLeft: "auto", color: muted, display: "flex" }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: 8, borderTop: `1px solid ${border}`, display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder="Add a comment…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="nowheel"
          style={{ flex: 1, resize: "none", maxHeight: 90, fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: `1px solid ${border}`, background: dark ? "rgba(255,255,255,.04)" : "#fff", color: txt, outline: "none" }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          style={{ fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 8, background: "var(--color-accent)", color: "#fff", border: "none", opacity: text.trim() ? 1 : 0.5, cursor: text.trim() ? "pointer" : "default" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

let _idSeq = 1;
function freshId(prefix) {
  // 36ms time + counter is plenty to avoid id collisions inside one
  // tab without dragging in a uuid dep just for this.
  return `${prefix}-${Date.now().toString(36)}-${_idSeq++}`;
}

// Shared by cloneNodes / alt-drag clone: expand the picked ids to any framed
// children, drop zones, and mint fresh ids for the copies.
function collectCloneSources(all, ids) {
  const set = new Set(ids);
  for (const n of all) if (n.parentId && set.has(n.parentId)) set.add(n.id); // frame children ride along
  const src = all.filter((n) => set.has(n.id) && n.type !== "zone");
  const idMap = new Map(src.map((n) => [n.id, freshId(n.type || "dup")]));
  return { src, idMap };
}

// Duplicate the edges fully inside a cloned selection onto the fresh ids.
function duplicateInternalEdges(eds, idMap) {
  const inside = eds.filter((e) => idMap.has(e.source) && idMap.has(e.target));
  if (!inside.length) return eds;
  return eds.concat(
    inside.map((e) => ({
      ...e,
      id: freshId("e"),
      selected: false,
      source: idMap.get(e.source),
      target: idMap.get(e.target),
      data: e.data ? { ...e.data } : e.data, // anchors are node-relative; route re-bases off the new ends
    }))
  );
}

// In-app clipboard for copy / cut / paste. localStorage so it survives
// navigation between boards and works across tabs. Holds CLEANED nodes/edges
// keeping their ORIGINAL ids, so paste can remap them — preserving internal
// edges and frame parenting. (Not the OS clipboard — staying in-app avoids
// permission prompts and serialization quirks.)
const WB_CLIPBOARD_KEY = "ql_wb_clipboard";
function readWbClipboard() {
  try {
    const raw = localStorage.getItem(WB_CLIPBOARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeWbClipboard(payload) {
  try {
    localStorage.setItem(WB_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch {
    /* storage disabled / quota — clipboard just no-ops */
  }
}

// Remember each board's pan/zoom so reopening it lands you where you left off
// (full-page boards only — embedded room boards still fit-to-view each time).
function loadViewport(boardId) {
  if (!boardId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(`ql_wb_viewport:${boardId}`) || "null");
    if (v && typeof v.x === "number" && typeof v.y === "number" && typeof v.zoom === "number") return v;
  } catch { /* */ }
  return null;
}
function saveViewport(boardId, vp) {
  if (!boardId || !vp) return;
  try {
    localStorage.setItem(`ql_wb_viewport:${boardId}`, JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom }));
  } catch { /* */ }
}

// Default style (font / size / colour / align) seeded into every new text node,
// remembered per device — like the sticky tool remembers its colour.
const TEXT_STYLE_KEY = "ql_wb_text_style";
function loadTextStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(TEXT_STYLE_KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function saveTextStyle(style) {
  try { localStorage.setItem(TEXT_STYLE_KEY, JSON.stringify(style || {})); } catch { /* */ }
}

// Remembered pen colour + width for the freehand tool (per device).
const PEN_STYLE_KEY = "ql_wb_pen_style";
const PEN_COLORS = [
  "#0f172a", "#475569", "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#ffffff",
];
const PEN_WIDTHS = [["Fine", 2], ["Medium", 4], ["Bold", 8]];
function loadPenStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(PEN_STYLE_KEY) || "null");
    if (v && typeof v.color === "string") return { color: v.color, width: v.width || 4 };
  } catch { /* */ }
  return { color: "#0f172a", width: 4 };
}
function savePenStyle(style) {
  try { localStorage.setItem(PEN_STYLE_KEY, JSON.stringify(style)); } catch { /* */ }
}

// Remembered raster-brush settings (colour / size / opacity / eraser).
const BRUSH_STYLE_KEY = "ql_wb_brush_style";
function loadBrushStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(BRUSH_STYLE_KEY) || "null");
    if (v && typeof v.color === "string") {
      return { color: v.color, size: v.size || 18, opacity: v.opacity ?? 1, erase: false };
    }
  } catch { /* */ }
  return { color: "#0ea5e9", size: 18, opacity: 1, erase: false };
}
function saveBrushStyle(style) {
  // Eraser is a transient mode, not a saved preference.
  try { localStorage.setItem(BRUSH_STYLE_KEY, JSON.stringify({ color: style.color, size: style.size, opacity: style.opacity })); } catch { /* */ }
}

// Chosen laser colour (per device). null = fall back to my cursor colour.
const LASER_COLOR_KEY = "ql_wb_laser_color";
function loadLaserColor() {
  try { return localStorage.getItem(LASER_COLOR_KEY) || null; } catch { return null; }
}
function saveLaserColor(c) {
  try { if (c) localStorage.setItem(LASER_COLOR_KEY, c); } catch { /* */ }
}

export default function WhiteboardPage() {
  const { whiteboardId } = useParams();
  return <WhiteboardBoard boardId={whiteboardId} />;
}

// Reusable board: the full editor wrapped in its own ReactFlowProvider so
// it can be dropped into the /whiteboards route (above) OR a room panel
// tile. `embedded` trims page-only chrome (back link, archive, full-
// viewport height) so it fits inside an arbitrary container.
// Region capture: a full-cover overlay that lets you drag a box over the canvas
// to export just that area as a PNG (a "snip" tool). It grabs the drag itself —
// so nodes don't move and the canvas doesn't pan — and exits on release. The two
// corners convert through screenToFlowPosition, so the captured bounds are in
// flow space regardless of the current pan/zoom. A dashed box dims everything
// outside the selection while dragging.
function RegionCapture({ toFlow, onComplete, onCancel, dark }) {
  const [box, setBox] = useState(null); // client-space rect for the visual
  const startRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = true;
    setBox({ l: e.clientX, t: e.clientY, w: 0, h: 0 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const move = (e) => {
    if (!draggingRef.current) return;
    const s = startRef.current;
    setBox({ l: Math.min(s.x, e.clientX), t: Math.min(s.y, e.clientY), w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y) });
  };
  const up = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const s = startRef.current;
    setBox(null);
    let a, b;
    try {
      a = toFlow({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY) });
      b = toFlow({ x: Math.max(s.x, e.clientX), y: Math.max(s.y, e.clientY) });
    } catch { onCancel(); return; }
    const bounds = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    if (bounds.width < 8 || bounds.height < 8) { onCancel(); return; } // a click, not a drag
    onComplete(bounds);
  };

  return (
    <div
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      style={{ position: "absolute", inset: 0, zIndex: 50, cursor: "crosshair", background: "transparent", touchAction: "none" }}
    >
      {box && (
        <div
          style={{
            position: "fixed", left: box.l, top: box.t, width: box.w, height: box.h,
            border: "2px dashed #38bdf8", background: "rgba(56,189,248,0.10)",
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.30)", pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
          background: dark ? "rgba(2,6,23,0.92)" : "rgba(15,23,42,0.88)", color: "#fff",
          fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 9999,
          pointerEvents: "none", whiteSpace: "nowrap", zIndex: 51,
        }}
      >
        Drag to capture a region · Esc to cancel
      </div>
    </div>
  );
}

export function WhiteboardBoard({ boardId, embedded = false, readOnly = false }) {
  return (
    <ReactFlowProvider>
      <WhiteboardEditor boardId={boardId} embedded={embedded} readOnly={readOnly} />
    </ReactFlowProvider>
  );
}

function WhiteboardEditor({ boardId, embedded = false, readOnly = false }) {
  const { theme } = useTheme();
  const { isAdmin, activeTeamId } = useTeam();
  const navigate = useNavigate();
  const dark = theme === "dark";

  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // When embedded in a small room tile, shed the heavier chrome (minimap,
  // goal banner, badges) so the canvas stays usable.
  const mainRef = useRef(null);
  const [compact, setCompact] = useState(false);
  // Whether the title bar's extra tools (reactions / timer / minimap / export /
  // capture / template) are shown. Auto-collapses when the board gets small so
  // the bar stays a single row; a toggle reveals them (they wrap to a second
  // row when the board is narrow).
  const [toolsOpen, setToolsOpen] = useState(true);
  // Left drawing toolbar: collapsible, wraps to 2 columns when the board is
  // small, and a "Q" keyboard shortcut pops a floating quick-tool palette.
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [palette, setPalette] = useState(null); // {x,y} viewport pos, or null

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  // Alignment-guide lines shown while dragging a single node (see ./snapping).
  const [helperLines, setHelperLines] = useState(NO_LINES);
  const helperShownRef = useRef(false);

  // Inline header edit state.
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  // Toggle for the floating emote reaction bar (per device). Peers'
  // emotes still render when off — only your bar is hidden.
  const [emoteBarOn, setEmoteBarOn] = useState(() => {
    try {
      return localStorage.getItem("ql_wb_emote_bar") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ql_wb_emote_bar", emoteBarOn ? "1" : "0");
    } catch {
      /* */
    }
  }, [emoteBarOn]);

  // View toggles — hide the countdown timer / minimap (remembered locally).
  const [showTimer, setShowTimer] = useState(() => {
    try { return localStorage.getItem("ql_wb_timer") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ql_wb_timer", showTimer ? "1" : "0"); } catch { /* */ }
  }, [showTimer]);
  const [showMinimap, setShowMinimap] = useState(() => {
    try { return localStorage.getItem("ql_wb_minimap") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ql_wb_minimap", showMinimap ? "1" : "0"); } catch { /* */ }
  }, [showMinimap]);
  const [saveTplOpen, setSaveTplOpen] = useState(false); // "Save as template" dialog

  // Measured height of the bottom toolbar (it can wrap to two rows on narrow
  // phones) — the paint toolbar and the emote bar stack above it by this.
  const toolbarRO = useRef(null);
  const [toolbarH, setToolbarH] = useState(44);
  const toolbarRef = useCallback((el) => {
    toolbarRO.current?.disconnect();
    toolbarRO.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight || 44;
      setToolbarH(h);
      // Portaled flyouts + the mobile inspector read this to clear the bar.
      document.documentElement.style.setProperty("--wb-toolbar-clear", `${15 + h + 8}px`);
    });
    ro.observe(el);
    toolbarRO.current = ro;
  }, []);
  const touchInspectorRO = useRef(null);
  const [touchInspectorH, setTouchInspectorH] = useState(TOUCH_INSPECTOR_FALLBACK_H);
  const touchInspectorRef = useCallback((el) => {
    touchInspectorRO.current?.disconnect();
    touchInspectorRO.current = null;
    if (!el) return;
    const update = () => setTouchInspectorH(el.offsetHeight || TOUCH_INSPECTOR_FALLBACK_H);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    touchInspectorRO.current = ro;
  }, []);

  // Long-press (350ms) then drag = marquee select on touch. RF's drag-marquee
  // is desktop-only here (on touch it opened under the first finger of every
  // pinch), so this owns the gesture: kill the pan d3 opened, draw the rect,
  // select intersecting nodes on release.
  const marqueeRef = useRef(null);
  const suppressPaneClickRef = useRef(0);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const marqueePointerDown = (e) => {
    if (!WB_TOUCH || e.pointerType !== "touch" || tool !== "select") return;
    const st = marqueeRef.current;
    if (st) {
      // Second finger — it's a pinch, not a marquee.
      if (!st.active) { clearTimeout(st.timer); marqueeRef.current = null; }
      return;
    }
    if (!(e.target instanceof Element)) return;
    const nodeEl = e.target.closest(".react-flow__node");
    if (nodeEl) {
      // Select on POINTERDOWN: Safari treats the first tap on nodes with
      // hover-revealed handles as hover only and eats the click, which made
      // selection take two taps.
      const id = nodeEl.getAttribute("data-id");
      if (id) {
        setNodes((nds) => {
          const t = nds.find((n) => n.id === id);
          if (!t || t.selected || t.type === "zone") return nds;
          return nds.map((n) => (n.id === id ? { ...n, selected: true } : n.selected ? { ...n, selected: false } : n));
        });
      }
      return; // a node press is never a marquee
    }
    if (!e.target.closest(".react-flow__pane")) return;
    const container = e.currentTarget;
    const { clientX: x0, clientY: y0, pointerId: id } = e;
    const timer = setTimeout(() => {
      const cur = marqueeRef.current;
      if (!cur || cur.id !== id) return;
      if (toolRef.current !== "select") {
        marqueeRef.current = null;
        return;
      }
      cur.active = true;
      navigator.vibrate?.(10);
      // End the pan gesture d3-zoom opened on this touch so the canvas
      // doesn't drift under the marquee.
      const pane = container.querySelector(".react-flow__pane");
      try {
        const touch = new Touch({ identifier: id, target: pane, clientX: x0, clientY: y0 });
        pane?.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true, changedTouches: [touch] }));
      } catch { /* Touch() unsupported — worst case the canvas pans slightly */ }
      setMarqueeRect({ x0, y0, x1: x0, y1: y0 });
    }, 350);
    marqueeRef.current = { id, x0, y0, x1: x0, y1: y0, active: false, timer };
  };
  const marqueePointerMove = (e) => {
    const st = marqueeRef.current;
    if (!st || e.pointerId !== st.id) return;
    if (!st.active) {
      // Moved before the hold elapsed — it's a pan; stand down.
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 12) {
        clearTimeout(st.timer);
        marqueeRef.current = null;
      }
      return;
    }
    e.stopPropagation();
    st.x1 = e.clientX;
    st.y1 = e.clientY;
    setMarqueeRect({ x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 });
  };
  const marqueePointerUp = (e) => {
    const st = marqueeRef.current;
    if (!st || e.pointerId !== st.id) return;
    marqueeRef.current = null;
    if (!st.active) { clearTimeout(st.timer); return; }
    e.stopPropagation();
    // The pane fires a click after release, which would clear the fresh
    // selection — swallow it (see onClickCapture below).
    suppressPaneClickRef.current = Date.now() + 500;
    setMarqueeRect(null);
    const minX = Math.min(st.x0, st.x1), maxX = Math.max(st.x0, st.x1);
    const minY = Math.min(st.y0, st.y1), maxY = Math.max(st.y0, st.y1);
    if (maxX - minX < 6 && maxY - minY < 6) return; // stationary hold — no-op
    const a = rf.screenToFlowPosition({ x: minX, y: minY });
    const b = rf.screenToFlowPosition({ x: maxX, y: maxY });
    const sel = new Set();
    for (const n of rf.getNodes()) {
      if (n.type === "zone") continue;
      const inode = rf.getInternalNode(n.id);
      const pos = inode?.internals?.positionAbsolute || n.position;
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      if (pos.x < b.x && pos.x + w > a.x && pos.y < b.y && pos.y + h > a.y) sel.add(n.id);
    }
    if (sel.size) {
      setNodes((nds) => nds.map((n) => (n.selected === sel.has(n.id) ? n : { ...n, selected: sel.has(n.id) })));
    }
  };
  // Draw modes: one finger draws, two fingers navigate. Once d3-zoom accepts
  // a touchstart (needed for pinch) it pans on ANY one-finger drag, stealing
  // strokes — so single-touch events are stopped in capture before its pane
  // listeners see them. Two-finger events pass through (pinch-zoom/pan), and
  // the pen/brush/laser handlers use POINTER events, which are unaffected.
  const blockSingleTouchInDraw = (e) => {
    if (!WB_TOUCH) return;
    if (tool !== "pen" && tool !== "brush" && tool !== "laser") return;
    if (e.touches.length === 1) e.stopPropagation();
  };
  const onEditorClickCapture = (e) => {
    if (Date.now() < suppressPaneClickRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // The editor is a fixed-viewport surface — lock body scrolling while it's
  // mounted (shared with Messages/Office) so iOS rubber-banding can't reveal
  // the page padding below the canvas or shove content under the tab bar.
  useBodyScrollLock(!embedded);

  // Default style seeded into new text nodes (persisted per device). A ref keeps
  // the latest for the stable double-click-create handler.
  const [textStyle, setTextStyleRaw] = useState(loadTextStyle);
  const textStyleRef = useRef(textStyle);
  textStyleRef.current = textStyle;
  const setTextStyle = useCallback((next) => { setTextStyleRaw(next); saveTextStyle(next); }, []);

  // Track the board's own size (only when embedded) to toggle compact chrome.
  useEffect(() => {
    if (!embedded) {
      setCompact(false);
      return;
    }
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCompact(r.width < 760 || r.height < 520);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded, board?.id, loading]);

  // Follow compactness: collapse the extra title-bar tools when the board turns
  // small, re-open them when it grows. Only fires on a compact *change*, so a
  // manual toggle in between is kept until the next threshold crossing.
  useEffect(() => { setToolsOpen(!compact); }, [compact]);

  // Escape closes the quick-tool palette (separate from the board key handler so
  // it isn't gated on board focus and reads fresh palette state).
  useEffect(() => {
    if (!palette) return undefined;
    const onEsc = (e) => { if (e.key === "Escape") setPalette(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [palette]);

  const lastSavedRef = useRef("");
  const saveTimerRef = useRef(null);
  const seededRef = useRef(false);
  const [saveState, setSaveState] = useState("idle"); // idle | dirty | saving | saved

  const rf = useReactFlow();
  const connectingRef = useRef(null);
  const connectKeyRef = useRef(null); // keydown handler active during a connect drag
  const [connecting, setConnecting] = useState(false); // a connect drag is in progress
  const [pickedShape, setPickedShape] = useState(null); // shape chosen via 1–9 mid-drag
  const { session, settings } = useApp();
  const myName =
    settings?.name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "";

  const collabEnabled = !loading && !!board?.id;

  // ── undo / redo (entity-scoped, multiplayer-safe). Set up BEFORE sync so it
  // can hand sync its onRemoteApply seam (peer edits fold into the baseline
  // and never become my undo steps). See useWhiteboardHistory.
  const { undo, redo, canUndo, canRedo, onRemoteApply } = useWhiteboardHistory({
    nodes,
    edges,
    setNodes,
    setEdges,
    enabled: collabEnabled,
  });

  // ── live collaboration: broadcast node/edge diffs + cursors on top of
  // the snapshot-of-record, plus presence. See useWhiteboardSync.
  // Raster paint layer (tiled). Peer strokes arrive as vectors and rasterise
  // locally via the layer's imperative handle. onPaint is stable so it doesn't
  // churn the sync channel subscription.
  const paintRef = useRef(null);
  const onPaint = useCallback((p) => paintRef.current?.apply(p), []);

  const { peers, members, pushCursor, pushPaint, myColor } = useWhiteboardSync({
    boardId: board?.id,
    enabled: collabEnabled,
    nodes,
    edges,
    setNodes,
    setEdges,
    name: myName,
    onRemoteApply,
    onPaint,
  });

  // Active canvas tool: "select" (default), "laser" (ephemeral presenting
  // pointer) or "pen" (freehand draw). Laser/pen gate node interaction so you
  // can gesture/draw over the board without disturbing it.
  const [tool, setTool] = useState("select");
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Pen colour + width (persisted per device). A ref so the pointer handlers
  // read the latest without re-subscribing.
  const [penStyle, setPenStyle] = useState(loadPenStyle);
  const penStyleRef = useRef(penStyle);
  penStyleRef.current = penStyle;
  useEffect(() => { savePenStyle(penStyle); }, [penStyle]);

  // In-progress freehand stroke (FLOW coords) + its rAF-batched live preview.
  const drawingRef = useRef(null);
  const drawRafRef = useRef(0);
  const [drawPath, setDrawPath] = useState(null);

  // Ephemeral laser-ink trail (FLOW coords, timestamped) drawn while the laser
  // button is held — fades on its own, persists nothing. See LaserTrail.
  const laserInkRef = useRef([]);
  const laserDrawingRef = useRef(false);
  // Drives the local laser dot's visibility — it only shows while pressing.
  const [laserPressing, setLaserPressing] = useState(false);

  // Raster brush settings (persisted) + the in-progress paint stroke. Local
  // points rasterise immediately; broadcasts go out in ~70ms batches.
  const [brushStyle, setBrushStyle] = useState(loadBrushStyle);
  const brushStyleRef = useRef(brushStyle);
  brushStyleRef.current = brushStyle;
  useEffect(() => { saveBrushStyle(brushStyle); }, [brushStyle]);

  // Laser dot/ink colour: a chosen colour, or my cursor colour by default.
  const [laserColor, setLaserColor] = useState(loadLaserColor);
  useEffect(() => { saveLaserColor(laserColor); }, [laserColor]);
  const effectiveLaserColor = laserColor || myColor;
  const laserColorRef = useRef(effectiveLaserColor);
  laserColorRef.current = effectiveLaserColor;
  const paintStrokeIdRef = useRef(null);
  const paintBrushRef = useRef(null);
  const paintBatchRef = useRef([]);
  const paintLastFlushRef = useRef(0);
  const flushPaint = useCallback(() => {
    const id = paintStrokeIdRef.current;
    const pts = paintBatchRef.current;
    if (!id || !pts.length) return;
    paintBatchRef.current = [];
    pushPaint({ id, brush: paintBrushRef.current, pts });
  }, [pushPaint]);

  // Last pointer position in FLOW coords — so paste lands under the cursor.
  const lastPtRef = useRef(null);
  const lastClientRef = useRef(null); // last cursor position in SCREEN coords
  // The single pointer that owns the current pen/laser/brush stroke. A second
  // finger landing mid-stroke means navigation (pinch) — abort the stroke so
  // it doesn't zigzag between the two fingers.
  const strokePidRef = useRef(null);
  const cancelActiveStroke = useCallback(() => {
    strokePidRef.current = null;
    if (laserDrawingRef.current) {
      laserDrawingRef.current = false;
      setLaserPressing(false);
      const lp = lastPtRef.current;
      if (lp) pushCursor(lp.x, lp.y, false, false, laserColorRef.current);
    }
    if (paintStrokeIdRef.current) {
      const id = paintStrokeIdRef.current;
      pushPaint({ id, brush: paintBrushRef.current, pts: paintBatchRef.current, end: true });
      paintBatchRef.current = [];
      paintRef.current?.apply({ id, brush: paintBrushRef.current, pts: [], end: true }, true);
      paintStrokeIdRef.current = null;
    }
    if (drawingRef.current) {
      drawingRef.current = null;
      if (drawRafRef.current) { cancelAnimationFrame(drawRafRef.current); drawRafRef.current = 0; }
      setDrawPath(null);
    }
  }, [pushCursor, pushPaint]);

  const onWbPointerMove = useCallback(
    (e) => {
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      try {
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        lastPtRef.current = { x: p.x, y: p.y };
        // Laser dot (mine + peers') shows only while pressing, so broadcast the
        // laser flag tied to the press, not just the mode.
        pushCursor(p.x, p.y, laserDrawingRef.current, laserDrawingRef.current, laserColorRef.current);
        // Only the stroke-owning pointer extends it — a stray second finger
        // must not feed points in.
        const owns = strokePidRef.current === null || strokePidRef.current === e.pointerId;
        // Laser ink: append while the button is held (the trail fades itself).
        if (owns && laserDrawingRef.current) {
          const arr = laserInkRef.current;
          const last = arr[arr.length - 1];
          if (!last || Math.abs(p.x - last.x) + Math.abs(p.y - last.y) > 1) {
            arr.push({ x: p.x, y: p.y, t: Date.now() });
          }
        }
        // Raster brush: rasterise locally each move; batch the broadcast.
        if (owns && paintStrokeIdRef.current) {
          paintRef.current?.apply({ id: paintStrokeIdRef.current, brush: paintBrushRef.current, pts: [[p.x, p.y]] }, true);
          paintBatchRef.current.push([p.x, p.y]);
          const now = Date.now();
          if (now - paintLastFlushRef.current > 70) { paintLastFlushRef.current = now; flushPaint(); }
        }
        const dr = owns ? drawingRef.current : null;
        if (dr) {
          const last = dr.points[dr.points.length - 1];
          // Drop near-duplicate samples so the path stays light.
          if (!last || Math.abs(p.x - last[0]) + Math.abs(p.y - last[1]) > 1.2) {
            dr.points.push([p.x, p.y]);
            if (!drawRafRef.current) {
              drawRafRef.current = requestAnimationFrame(() => {
                drawRafRef.current = 0;
                setDrawPath(strokePath(drawingRef.current?.points || []));
              });
            }
          }
        }
      } catch {
        /* */
      }
    },
    [rf, pushCursor, flushPaint]
  );

  // Pen down: begin a stroke. Capture-phase so it wins over the (disabled in
  // pen mode) ReactFlow pane/node handlers, and works when starting over a
  // node. Only fires inside the canvas, never over the toolbar/controls.
  const onWbPointerDownCapture = useCallback(
    (e) => {
      const mode = toolRef.current;
      if ((mode !== "pen" && mode !== "laser" && mode !== "brush") || e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest(".react-flow") || t.closest(".react-flow__panel")) return;
      // In laser / brush mode, ⌘/Ctrl+drag pans (handled by ReactFlow), so the
      // left-drag stays free for the laser ink / brush — don't capture it.
      if ((mode === "laser" || mode === "brush") && (e.ctrlKey || e.metaKey)) return;
      if (strokePidRef.current != null) {
        // Second finger mid-stroke → the user is pinching to navigate.
        cancelActiveStroke();
        return;
      }
      let p;
      try { p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch { return; }
      if (mode === "pen") {
        drawingRef.current = { points: [[p.x, p.y]] };
        setDrawPath(strokePath(drawingRef.current.points));
      } else if (mode === "laser") {
        laserDrawingRef.current = true;
        setLaserPressing(true);
        laserInkRef.current = [{ x: p.x, y: p.y, t: Date.now() }];
        pushCursor(p.x, p.y, true, true, laserColorRef.current);
      } else {
        // brush: open a paint stroke, rasterise the first dab, start streaming.
        const bs = brushStyleRef.current;
        const brush = {
          color: bs.erase ? "#000000" : bs.color,
          size: bs.size,
          opacity: bs.erase ? 1 : bs.opacity,
          mode: bs.erase ? "eraser" : "brush",
        };
        const id = freshId("pt");
        paintStrokeIdRef.current = id;
        paintBrushRef.current = brush;
        paintBatchRef.current = [[p.x, p.y]];
        paintLastFlushRef.current = Date.now();
        paintRef.current?.apply({ id, brush, pts: [[p.x, p.y]] }, true);
      }
      strokePidRef.current = e.pointerId;
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* */ }
      e.preventDefault();
    },
    [rf, pushCursor, cancelActiveStroke]
  );

  // Pen up: commit the stroke as a draw node (bbox-relative points). Tiny taps
  // are dropped. The node carries pointerEvents:none so it's click-through
  // except along the line (see DrawNode).
  const finishStroke = useCallback(() => {
    const dr = drawingRef.current;
    drawingRef.current = null;
    if (drawRafRef.current) { cancelAnimationFrame(drawRafRef.current); drawRafRef.current = 0; }
    setDrawPath(null);
    if (!dr || dr.points.length < 2) return;
    const pts = dr.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    const { color, width } = penStyleRef.current;
    const pad = Math.max(width, 4);
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    if (w < 4 && h < 4) return; // discard a stray dot
    const rel = pts.map(([x, y]) => [Math.round((x - minX) * 10) / 10, Math.round((y - minY) * 10) / 10]);
    const node = {
      id: freshId("draw"),
      type: "draw",
      position: { x: minX, y: minY },
      width: w,
      height: h,
      style: { pointerEvents: "none" },
      data: { points: rel, color, strokeWidth: width, w, h },
    };
    // Don't auto-select — keep the pen flowing for the next stroke.
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(node));
  }, [setNodes]);

  const onWbPointerUp = useCallback(
    (e) => {
      // Only the stroke-owning pointer ends it.
      if (strokePidRef.current != null && e.pointerId !== strokePidRef.current) return;
      strokePidRef.current = null;
      if (laserDrawingRef.current) {
        laserDrawingRef.current = false;
        setLaserPressing(false);
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* */ }
        // Released: drop the laser flag so my dot + peers' hide; the ink trail
        // fades out on its own.
        const lp = lastPtRef.current;
        if (lp) pushCursor(lp.x, lp.y, false, false, laserColorRef.current);
        return;
      }
      if (paintStrokeIdRef.current) {
        const id = paintStrokeIdRef.current;
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* */ }
        // Flush the tail + tell peers the stroke ended; close it locally too.
        pushPaint({ id, brush: paintBrushRef.current, pts: paintBatchRef.current, end: true });
        paintBatchRef.current = [];
        paintRef.current?.apply({ id, brush: paintBrushRef.current, pts: [], end: true }, true);
        paintStrokeIdRef.current = null;
        return;
      }
      if (!drawingRef.current) return;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* */ }
      finishStroke();
    },
    [finishStroke, pushCursor, pushPaint]
  );

  // On a tool switch, push one cursor update reflecting the new mode so peers
  // flip my arrow ↔ laser immediately (even if I've stopped moving).
  useEffect(() => {
    const p = lastPtRef.current;
    // Switching tools never shows a laser dot now — it only appears on press.
    if (p) pushCursor(p.x, p.y, false, false, laserColorRef.current);
  }, [tool, pushCursor]);

  // Keyboard navigation: ⌘/Ctrl +/−/0 zoom, Shift+1 fits, arrows pan (when
  // nothing's selected — otherwise React Flow nudges the selected node).
  // Gated to when the board is hovered/focused and you're not typing, so it
  // doesn't hijack keys for the rest of the app (e.g. an embedded room).
  useEffect(() => {
    function onKey(e) {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      const board = mainRef.current;
      if (!board || !(board.matches(":hover") || board.contains(el))) return;
      // Escape drops back to the select tool (exit laser mode).
      if (e.key === "Escape") { setTool("select"); return; }
      // "Q" pops the quick-tool palette at the cursor (so items spawn where you
      // are) — works even when the left toolbar is collapsed. Falls back to the
      // board centre if we haven't seen the pointer yet.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        const r = mainRef.current?.getBoundingClientRect();
        const at = lastClientRef.current || (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 200, y: 200 });
        setPalette((p) => (p ? null : at));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && k === "c") {
        // Only swallow the key if we actually copied nodes — otherwise let
        // the browser copy selected text as usual.
        if (copyRef.current?.()) e.preventDefault();
      } else if (mod && k === "x") {
        if (cutRef.current?.()) e.preventDefault();
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        rf.zoomIn({ duration: 150 });
      } else if (mod && e.key === "-") {
        e.preventDefault();
        rf.zoomOut({ duration: 150 });
      } else if (mod && e.key === "0") {
        e.preventDefault();
        rf.zoomTo(1, { duration: 150 });
      } else if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        const sel = rf
          .getNodes()
          .filter((n) => n.selected && n.type !== "zone")
          .map((n) => n.id);
        if (sel.length) cloneRef.current?.(sel);
      } else if (e.shiftKey && e.key === "1") {
        e.preventDefault();
        rf.fitView({ padding: 0.15, duration: 200 });
      } else if (e.key.startsWith("Arrow")) {
        if (rf.getNodes().some((n) => n.selected)) return; // let RF move the node
        const step = e.shiftKey ? 200 : 60;
        const d = {
          ArrowLeft: [step, 0],
          ArrowRight: [-step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        }[e.key];
        if (!d) return;
        e.preventDefault();
        const vp = rf.getViewport();
        rf.setViewport({ x: vp.x + d[0], y: vp.y + d[1], zoom: vp.zoom });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf, undo, redo]);

  // ── load board metadata + snapshot, seed template if empty ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!boardId) return;
      setLoading(true);
      setError("");
      const { data, error: err } = await fetchWhiteboardById(boardId);
      if (cancelled) return;
      if (err || !data) {
        setError(err?.message || "Whiteboard not found.");
        setBoard(null);
        setLoading(false);
        return;
      }
      setBoard(data);
      setTitleDraft(data.title || "");
      setGoalDraft(data.goal || "");
      // Snapshot OR template seed.
      let snap = data.snapshot;
      if (!snap || isEmptySnapshot(snap)) {
        if (!seededRef.current) {
          seededRef.current = true;
          snap = templateSnapshotFor(data.template_key);
        } else {
          snap = { nodes: [], edges: [] };
        }
      }
      // Strip any legacy extent:"parent" clamp so children dragged in from
      // older boards/templates aren't trapped in their frame.
      const loadedNodes = declampNodes(snap.nodes || []);
      const loadedEdges = snap.edges || [];
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      // Stamp our baseline from the (declamped) state we actually set so the
      // first save-tick doesn't round-trip — the board re-saves clean on the
      // next real edit.
      lastSavedRef.current = JSON.stringify({
        nodes: loadedNodes,
        edges: loadedEdges,
      });
      setLoading(false);
      // Restore this board's saved pan/zoom (full-page only); a first visit or
      // an embedded board falls back to fit-to-view. Deferred so layout settles.
      const savedVp = embedded ? null : loadViewport(data.id);
      setTimeout(() => {
        try {
          if (savedVp) rf.setViewport(savedVp, { duration: 0 });
          else rf.fitView({ padding: 0.15, duration: 0 });
        } catch {
          /* */
        }
      }, 60);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // ── debounced save on every node / edge change ──
  // We collapse rapid edits into a single network call. The save is
  // gated on the serialized snapshot diff so things like cursor moves
  // that don't change state don't burn writes.
  useEffect(() => {
    if (!board?.id) return;
    if (loading) return;
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const snap = { nodes, edges };
      const serialized = JSON.stringify(snap);
      if (serialized === lastSavedRef.current) {
        setSaveState("saved");
        return;
      }
      setSaveState("saving");
      const { error: err } = await saveSnapshot(board.id, snap);
      if (err) {
        setError(err.message || "Couldn't save changes.");
        setSaveState("dirty");
        return;
      }
      lastSavedRef.current = serialized;
      setSaveState("saved");
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, board?.id, loading]);

  // Load every Google font in use (including fonts that arrive from peers via
  // sync). ensureGoogleFont is idempotent and a no-op for the built-in presets.
  useEffect(() => {
    for (const n of nodes) ensureGoogleFont(n.data?.fontFamily);
  }, [nodes]);

  // Flush pending edits on unmount / tab close.
  useEffect(() => {
    function flush() {
      if (!saveTimerRef.current || !board?.id) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const snap = { nodes, edges };
      const serialized = JSON.stringify(snap);
      if (serialized === lastSavedRef.current) return;
      saveSnapshot(board.id, snap);
      lastSavedRef.current = serialized;
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [board?.id, nodes, edges]);

  // ── handlers ──
  // Connection completion is handled entirely in onConnectEnd (so we can
  // attach to ANY point on a node, not just its 4 handles). onConnect is a
  // no-op to avoid a second, handle-snapped edge being created.
  const onConnect = useCallback(() => {}, []);

  const onConnectStart = useCallback((evt, params) => {
    const e = evt && "touches" in evt ? evt.touches[0] : evt;
    // Remember where the pull began so onConnectEnd can tell a click
    // (auto-place a sibling) from a drag (drop where released).
    connectingRef.current = { ...params, sx: e?.clientX, sy: e?.clientY, shape: null };
    setConnecting(true);
    setPickedShape(null);
    // While dragging out a connector, press 1–9 / 0 to choose the NEW node's
    // shape (in the toolbar catalogue's order: 1 Process, 3 Decision, …). The
    // last number pressed wins — it updates the live ghost and is applied on
    // release. A legend appears during the drag so the mapping is visible.
    const onKey = (ke) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!connectingRef.current || !/^[0-9]$/.test(ke.key)) return;
      const idx = ke.key === "0" ? 9 : Number(ke.key) - 1;
      const s = SHAPES[idx];
      if (s) { connectingRef.current.shape = s.key; setPickedShape(s.key); ke.preventDefault(); }
    };
    connectKeyRef.current = onKey;
    window.addEventListener("keydown", onKey);
  }, []);

  // Pull a connector from a node and either DRAG onto empty canvas (the new
  // node spawns where you drop) or just CLICK the handle (it auto-places a
  // sibling beside the parent — FigJam quick-add). Either way the new node
  // is "similar to the parent": same type/shape/size/fill, so flows stay
  // visually consistent. Placement uses the SAME helper as the live preview
  // so the ghost always matches the result.
  //
  // We use connectionState.fromNode rather than gating on handleType:
  // each side carries overlapping source+target handles (target on top,
  // for drop-to-connect), so a pull can start on either — what matters
  // is only WHICH node it came from.
  const onConnectEnd = useCallback(
    (event, connectionState) => {
      const started = connectingRef.current;
      connectingRef.current = null;
      if (connectKeyRef.current) {
        window.removeEventListener("keydown", connectKeyRef.current);
        connectKeyRef.current = null;
      }
      setConnecting(false);
      setPickedShape(null);
      const srcNode = connectionState?.fromNode;
      const fromNodeId = srcNode?.id ?? started?.nodeId;
      if (!fromNodeId) return;
      const fromHandle = connectionState?.fromHandle;
      const sourceHandle =
        SIDE_FROM_ID[fromHandle?.id] ??
        SIDE_FROM_ID[started?.handleId] ??
        SIDE_FROM_POS[fromHandle?.position] ??
        "r";
      const ev = "changedTouches" in event ? event.changedTouches[0] : event;
      if (ev?.clientX == null) return;
      let pos;
      try {
        pos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      } catch {
        return;
      }

      // What node did we release over? (skip containers; small margin so a
      // drop right on the border still counts.)
      const M2 = 8;
      const overNode = rf.getNodes().find((n) => {
        if (NON_CONNECTABLE.has(n.type)) return false;
        const r = nodeRect(n);
        return (
          r &&
          pos.x >= r.x - M2 &&
          pos.x <= r.x + r.w + M2 &&
          pos.y >= r.y - M2 &&
          pos.y <= r.y + r.h + M2
        );
      });

      // Released over ANOTHER node → connect to it. Both ends are YOUR choice:
      // the source leaves from the side you pulled from, and the target attaches
      // at the perimeter point you dropped on (snapped to the nearest tidy spot,
      // matching the options shown during the drag).
      if (overNode && overNode.id !== fromNodeId) {
        const sSide = SIDE_POS[sourceHandle] || "right"; // the side you pulled from
        const sourceAnchor = { side: sSide, t: 0.5, auto: true };
        const targetAnchor = snappedAnchor(nodeRect(overNode), pos.x, pos.y);
        setEdges((eds) =>
          addEdge(
            {
              source: fromNodeId,
              sourceHandle,
              target: overNode.id,
              targetHandle: ANCHOR_TO_HANDLE[targetAnchor.side],
              data: { sourceAnchor, targetAnchor },
              ...DEFAULT_EDGE_OPTIONS,
            },
            eds
          )
        );
        return;
      }

      // New node mirrors the parent (fall back to a default process box).
      const isShapeParent = ["shape", "rect", "ellipse", "diamond"].includes(
        srcNode?.type
      );
      const size = {
        w: srcNode?.measured?.width ?? srcNode?.width ?? DEFAULTS.shape.w,
        h: srcNode?.measured?.height ?? srcNode?.height ?? DEFAULTS.shape.h,
      };
      const newData = {
        text: "",
        // A number pressed mid-drag wins, then a hover pre-pick, then the parent.
        shape: started?.shape || pickedShape || (isShapeParent && srcNode?.data?.shape) || "process",
        ...(srcNode?.data?.fill ? { fill: srcNode.data.fill } : {}),
        ...(srcNode?.data?.stroke ? { stroke: srcNode.data.stroke } : {}),
        ...(srcNode?.data?.fontSize ? { fontSize: srcNode.data.fontSize } : {}),
      };

      // Quick-add vs drag-to-place. A "click" isn't decided by movement
      // distance (unreliable for a tap on a handle) but by whether you
      // RELEASED on/near the parent rather than dragging away. That makes
      // quick-add fire reliably on every side — including straight under the
      // node, which the distance check used to miss.
      const hasGeom = srcNode?.position != null;
      const sx0 = srcNode?.position?.x ?? 0;
      const sy0 = srcNode?.position?.y ?? 0;
      const M = 30; // generous — a click on the OUTSIDE arrow still counts as quick-add
      const nearParent =
        hasGeom &&
        pos.x >= sx0 - M &&
        pos.x <= sx0 + size.w + M &&
        pos.y >= sy0 - M &&
        pos.y <= sy0 + size.h + M;
      let place;
      if (hasGeom && nearParent) {
        place = siblingPlacement(
          { x: sx0, y: sy0, w: size.w, h: size.h },
          sourceHandle,
          size
        );
      } else if (hasGeom) {
        const center = { x: sx0 + size.w / 2, y: sy0 + size.h / 2 };
        place = connectedNodePlacement(center, pos.x, pos.y, size);
      } else {
        place = {
          x: pos.x - size.w / 2,
          y: pos.y - size.h / 2,
          side: sourceHandle ? OPPOSITE_TARGET[sourceHandle] : "l",
        };
      }

      // Snap the new node to the grid so it lines up with everything else.
      place = { ...place, x: snapToGrid(place.x), y: snapToGrid(place.y) };

      // Context-aware: if a node already sits where the new one would land, just
      // connect to IT instead of dropping a duplicate.
      const zonePad = 0.4;
      const zone = {
        x: place.x - size.w * zonePad, y: place.y - size.h * zonePad,
        w: size.w * (1 + 2 * zonePad), h: size.h * (1 + 2 * zonePad),
      };
      const nearby = rf.getNodes().find((n) => {
        if (n.id === fromNodeId || NON_CONNECTABLE.has(n.type)) return false;
        const r = nodeRect(n);
        return r && r.x < zone.x + zone.w && r.x + r.w > zone.x && r.y < zone.y + zone.h && r.y + r.h > zone.y;
      });
      if (nearby) {
        setEdges((eds) => {
          if (eds.some((e) =>
            (e.source === fromNodeId && e.target === nearby.id) ||
            (e.source === nearby.id && e.target === fromNodeId)
          )) return eds;
          return addEdge({
            source: fromNodeId, sourceHandle, target: nearby.id, targetHandle: place.side,
            data: { sourceAnchor: { side: SIDE_POS[sourceHandle] || "right", t: 0.5, auto: true } },
            ...DEFAULT_EDGE_OPTIONS,
          }, eds);
        });
        return;
      }

      const newId = freshId("shape");
      markNodeForEdit(newId); // open the new node straight into text edit
      // Auto-select the new node (and deselect the rest) so its inspector
      // pops immediately — pull, drop, restyle.
      setNodes((nds) =>
        nds
          .map((n) => (n.selected ? { ...n, selected: false } : n))
          .concat({
            id: newId,
            type: "shape",
            position: { x: place.x, y: place.y },
            width: size.w,
            height: size.h,
            data: newData,
            selected: true,
          })
      );
      setEdges((eds) =>
        addEdge(
          {
            source: fromNodeId,
            sourceHandle,
            target: newId,
            targetHandle: place.side,
            // Lock the SOURCE to the side you pulled from; the new node's end
            // floats and just faces it (complementSide), so the edge leaves
            // where you pulled and the far end receives it on its near side.
            data: {
              sourceAnchor: { side: SIDE_POS[sourceHandle] || "right", t: 0.5, auto: true },
            },
            ...DEFAULT_EDGE_OPTIONS,
          },
          eds
        )
      );
    },
    [rf, setNodes, setEdges, pickedShape]
  );

  // Click an arrow → quick-add a connected shape on that side (drag is handled
  // by React Flow's connection → onConnectEnd; connectOnClick is off so a click
  // doesn't enter click-to-connect mode). Same picked-shape + context-aware
  // (connect-to-existing) rules as the drag path.
  const quickAddConnected = useCallback((fromNodeId, sourceHandle) => {
    const srcNode = rf.getNodes().find((n) => n.id === fromNodeId);
    if (!srcNode) return;
    const isShapeParent = ["shape", "rect", "ellipse", "diamond"].includes(srcNode.type);
    const size = {
      w: srcNode.measured?.width ?? srcNode.width ?? DEFAULTS.shape.w,
      h: srcNode.measured?.height ?? srcNode.height ?? DEFAULTS.shape.h,
    };
    const newData = {
      text: "",
      shape: pickedShape || (isShapeParent && srcNode.data?.shape) || "process",
      ...(srcNode.data?.fill ? { fill: srcNode.data.fill } : {}),
      ...(srcNode.data?.stroke ? { stroke: srcNode.data.stroke } : {}),
      ...(srcNode.data?.fontSize ? { fontSize: srcNode.data.fontSize } : {}),
    };
    const sx0 = srcNode.position?.x ?? 0;
    const sy0 = srcNode.position?.y ?? 0;
    let place = siblingPlacement({ x: sx0, y: sy0, w: size.w, h: size.h }, sourceHandle, size);
    place = { ...place, x: snapToGrid(place.x), y: snapToGrid(place.y) };
    const sourceAnchor = { side: SIDE_POS[sourceHandle] || "right", t: 0.5, auto: true };

    // If a node already sits where the new one would land, connect to it.
    const pad = 0.5;
    const zone = {
      x: place.x - size.w * pad, y: place.y - size.h * pad,
      w: size.w * (1 + 2 * pad), h: size.h * (1 + 2 * pad),
    };
    const existing = rf.getNodes().find((n) => {
      if (n.id === fromNodeId || NON_CONNECTABLE.has(n.type)) return false;
      const r = nodeRect(n);
      return r && r.x < zone.x + zone.w && r.x + r.w > zone.x && r.y < zone.y + zone.h && r.y + r.h > zone.y;
    });
    if (existing) {
      setEdges((eds) => {
        if (eds.some((e) =>
          (e.source === fromNodeId && e.target === existing.id) ||
          (e.source === existing.id && e.target === fromNodeId)
        )) return eds;
        return addEdge({
          source: fromNodeId, sourceHandle, target: existing.id, targetHandle: place.side,
          data: { sourceAnchor }, ...DEFAULT_EDGE_OPTIONS,
        }, eds);
      });
      setPickedShape(null);
      return;
    }

    const newId = freshId("shape");
    markNodeForEdit(newId);
    setNodes((nds) =>
      nds
        .map((n) => (n.selected ? { ...n, selected: false } : n))
        .concat({
          id: newId, type: "shape",
          position: { x: place.x, y: place.y },
          width: size.w, height: size.h, data: newData, selected: true,
        })
    );
    setEdges((eds) =>
      addEdge({
        source: fromNodeId, sourceHandle, target: newId, targetHandle: place.side,
        data: { sourceAnchor }, ...DEFAULT_EDGE_OPTIONS,
      }, eds)
    );
    setPickedShape(null);
  }, [rf, setNodes, setEdges, pickedShape]);

  // Hover a shape's quick-connect arrow → 1–9/0 pre-picks the shape a click will
  // create (and lights it in the legend). Mirrors the during-drag number-select.
  const [hoveringArrow, setHoveringArrow] = useState(false);
  const onArrowHover = useCallback((v) => {
    setHoveringArrow(v);
    if (!v) setPickedShape(null); // leaving clears the pending pick
  }, []);
  useEffect(() => {
    if (!hoveringArrow) return undefined;
    const onKey = (ke) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!/^[0-9]$/.test(ke.key)) return;
      const idx = ke.key === "0" ? 9 : Number(ke.key) - 1;
      const s = SHAPES[idx];
      if (s) { setPickedShape(s.key); ke.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoveringArrow]);
  const quickConnectApi = useMemo(
    () => ({ connect: quickAddConnected, onHover: onArrowHover, pickedShape }),
    [quickAddConnected, onArrowHover, pickedShape]
  );

  // Drag an edge endpoint onto a different node to re-route it.
  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    },
    [setEdges]
  );

  // Snap-aware node changes. Grid snapping is done here PER NODE (not via the
  // global snapToGrid prop) so it can be skipped for sticky notes and any node
  // with snapping toggled off. Alignment guides run for a single dragged
  // content node. We snap the drag-END change too (dragging:false) so the
  // position holds on release instead of settling back to React Flow's raw spot.
  const onNodesChangeSnap = useCallback(
    (changes) => {
      const all = rf.getNodes();
      const byId = new Map(all.map((n) => [n.id, n]));
      // A resize emits `dimensions` changes flagged with `resizing` (true while
      // dragging a handle, false on release) — distinct from the unflagged
      // `dimensions` changes React Flow fires when it MEASURES a node, which we
      // must NOT snap (that would fight auto-sized nodes). Track the ids being
      // resized so we also snap the position a top/left handle moves.
      const isResize = (c) =>
        c.type === "dimensions" && c.dimensions && c.resizing != null;
      const resizingIds = new Set(changes.filter(isResize).map((c) => c.id));
      // Grid-snap dragged AND resized nodes that participate in snapping.
      for (const c of changes) {
        if (isResize(c)) {
          const n = byId.get(c.id);
          if (n && nodeSnaps(n))
            c.dimensions = {
              width: snapToGrid(c.dimensions.width),
              height: snapToGrid(c.dimensions.height),
            };
        } else if (
          c.type === "position" &&
          c.position &&
          (c.dragging != null || resizingIds.has(c.id))
        ) {
          const n = byId.get(c.id);
          if (n && nodeSnaps(n))
            c.position = {
              x: snapToGrid(c.position.x),
              y: snapToGrid(c.position.y),
            };
        }
      }
      // Alignment guides for a single dragged content node (not frame/zone).
      const drags = changes.filter(
        (c) => c.type === "position" && c.position && c.dragging != null
      );
      if (drags.length === 1) {
        const node = byId.get(drags[0].id);
        const w = node?.measured?.width ?? node?.width ?? 0;
        const h = node?.measured?.height ?? node?.height ?? 0;
        if (
          node &&
          node.type !== "frame" &&
          node.type !== "zone" &&
          nodeSnaps(node) &&
          w &&
          h
        ) {
          const parentAbs = node.parentId
            ? nodeAbsPos(byId.get(node.parentId), byId)
            : { x: 0, y: 0 };
          const dragRect = {
            x: parentAbs.x + drags[0].position.x,
            y: parentAbs.y + drags[0].position.y,
            w,
            h,
          };
          const others = [];
          for (const n of all) {
            if (n.id === node.id || n.id === node.parentId || n.type === "zone")
              continue;
            const r = nodeRect(n);
            if (r) others.push(r);
          }
          const g = getAlignmentGuides(
            dragRect,
            others,
            alignDistance(rf.getViewport().zoom)
          );
          if (g.x != null)
            drags[0].position = { ...drags[0].position, x: g.x - parentAbs.x };
          if (g.y != null)
            drags[0].position = { ...drags[0].position, y: g.y - parentAbs.y };
          // Guides only while live-dragging; on release just snap + clear.
          const live = drags[0].dragging === true;
          if (live && (g.vertical || g.horizontal)) {
            setHelperLines({ vertical: g.vertical, horizontal: g.horizontal });
            helperShownRef.current = true;
          } else if (helperShownRef.current) {
            setHelperLines(NO_LINES);
            helperShownRef.current = false;
          }
        } else if (helperShownRef.current) {
          setHelperLines(NO_LINES);
          helperShownRef.current = false;
        }
      } else if (helperShownRef.current) {
        setHelperLines(NO_LINES);
        helperShownRef.current = false;
      }

      // Resize alignment: snap the moving edge(s) of a single resized, top-level
      // node to other nodes' edges/centres + matching width/height, drawing the
      // same guides as drag. Runs AFTER the drag block so it owns the guide lines
      // during a resize. Aspect-locked (image), no-snap (sticky), frame and zone
      // nodes are skipped.
      const resizeChange = resizingIds.size === 1 ? changes.find(isResize) : null;
      const rzNode = resizeChange ? byId.get(resizeChange.id) : null;
      if (
        rzNode &&
        !rzNode.parentId &&
        rzNode.type !== "zone" &&
        rzNode.type !== "frame" &&
        rzNode.type !== "image" &&
        nodeSnaps(rzNode)
      ) {
        const oldW = rzNode.measured?.width ?? rzNode.width ?? 0;
        const oldH = rzNode.measured?.height ?? rzNode.height ?? 0;
        const oldX = rzNode.position?.x ?? 0;
        const oldY = rzNode.position?.y ?? 0;
        const cp = changes.find((c) => c.type === "position" && c.id === resizeChange.id);
        const newW = resizeChange.dimensions.width;
        const newH = resizeChange.dimensions.height;
        const newX = cp?.position?.x ?? oldX;
        const newY = cp?.position?.y ?? oldY;
        // A left/top handle moves x/y; a right/bottom handle changes only size.
        const edges = {
          left: Math.abs(newX - oldX) > 0.01,
          top: Math.abs(newY - oldY) > 0.01,
        };
        edges.right = !edges.left && Math.abs(newW - oldW) > 0.01;
        edges.bottom = !edges.top && Math.abs(newH - oldH) > 0.01;
        const others = [];
        for (const n of all) {
          if (n.id === rzNode.id || n.type === "zone") continue;
          const r = nodeRect(n);
          if (r) others.push(r);
        }
        const g = getResizeGuides(
          { x: newX, y: newY, w: newW, h: newH },
          edges,
          others,
          alignDistance(rf.getViewport().zoom)
        );
        resizeChange.dimensions = { width: g.w, height: g.h };
        if (cp && (g.x !== newX || g.y !== newY)) cp.position = { x: g.x, y: g.y };
        const live = resizeChange.resizing === true;
        if (live && (g.vertical || g.horizontal)) {
          setHelperLines({ vertical: g.vertical, horizontal: g.horizontal });
          helperShownRef.current = true;
        } else if (helperShownRef.current) {
          setHelperLines(NO_LINES);
          helperShownRef.current = false;
        }
      }
      onNodesChange(changes);
    },
    [rf, onNodesChange]
  );

  // Frame containers: when a node is dropped inside a frame, adopt it as a
  // child (so it moves with the frame); when dragged out, release it.
  const onNodeDragStop = useCallback(
    (_evt, node) => {
      altCloningRef.current = false; // re-arm alt-drag clone for the next drag
      if (helperShownRef.current) {
        setHelperLines(NO_LINES);
        helperShownRef.current = false;
      }
      if (!node || node.type === "frame" || node.type === "zone") return;
      setNodes((nds) => {
        const byId = new Map(nds.map((n) => [n.id, n]));
        const cur = byId.get(node.id);
        if (!cur) return nds;
        const abs = nodeAbsPos(cur, byId);
        const center = {
          x: abs.x + (cur.width || 0) / 2,
          y: abs.y + (cur.height || 0) / 2,
        };
        const hit = frameAt(center, nds, byId, node.id);
        let changed = false;
        const next = nds.map((n) => {
          if (n.id !== node.id) return n;
          if (hit && n.parentId !== hit.frame.id) {
            changed = true;
            // Adopt into the frame WITHOUT extent:"parent" — it moves with the
            // frame but stays free to drag back out.
            return {
              ...n,
              parentId: hit.frame.id,
              extent: undefined,
              position: { x: abs.x - hit.fp.x, y: abs.y - hit.fp.y },
            };
          }
          if (!hit && n.parentId) {
            changed = true;
            return {
              ...n,
              parentId: undefined,
              extent: undefined,
              position: abs,
            };
          }
          return n;
        });
        return changed ? sortParentsFirst(next) : nds;
      });
    },
    [setNodes]
  );

  const addNodeAtCenter = useCallback(
    // `atClient` (optional {x,y} in screen coords) drops the node under the
    // cursor — used by drag-from-toolbar. Omitted → near the visible center.
    (type, extra = {}, atClient = null) => {
      const size = DEFAULTS[type] || { w: 180, h: 100 };
      // Drop the new node near the visible center so the user sees it
      // appear without having to pan (or at the drop point when dragged).
      let centerWorld = { x: 200, y: 200 };
      try {
        if (atClient) {
          centerWorld = rf.screenToFlowPosition({ x: atClient.x, y: atClient.y });
        } else {
          const vp = rf.getViewport();
          // screen-center → world coords using viewport math
          const el = document.querySelector(".react-flow");
          if (el) {
            const r = el.getBoundingClientRect();
            centerWorld = rf.screenToFlowPosition({
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
            });
          } else {
            centerWorld = { x: -vp.x / vp.zoom + 200, y: -vp.y / vp.zoom + 200 };
          }
        }
      } catch {
        /* */
      }
      const sized = [
        "shape",
        "goal",
        "frame",
        "rect",
        "ellipse",
        "diamond",
        "sticky",
      ].includes(type);
      const node = {
        id: freshId(type),
        type,
        position: {
          x: centerWorld.x - size.w / 2,
          y: centerWorld.y - size.h / 2,
        },
        data:
          type === "sticky"
            ? {
                text: "",
                color: extra.color || preferredStickyColor(),
                author: myName,
              }
            : { text: "", ...extra },
        ...(sized ? { width: size.w, height: size.h } : {}),
        ...(type === "frame" ? { zIndex: -1 } : {}),
      };
      markNodeForEdit(node.id); // newly placed node opens straight into edit
      setNodes((nds) =>
        nds
          .map((n) => (n.selected ? { ...n, selected: false } : n))
          .concat({ ...node, selected: true })
      );
    },
    [rf, setNodes, myName]
  );

  // Upload an image to Storage, then drop an image node (sized to the image's
  // aspect ratio, capped) at the visible center. The node holds only the URL,
  // so it syncs/saves like any other node and is undoable.
  const fileInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const addImageNode = useCallback(
    async (file, at) => {
      if (!file) return;
      const uid = session?.user?.id;
      if (!uid) { setError("Sign in to add images."); return; }
      setUploadingImage(true);
      const { data, error: err } = await uploadWhiteboardImage(file, uid, board?.id);
      setUploadingImage(false);
      if (err || !data) { setError(err?.message || "Couldn't upload image."); return; }
      // Initial display box: cap the longest edge, keep the image's ratio.
      const MAX_EDGE = 320;
      const nw = data.width || DEFAULTS.image.w, nh = data.height || DEFAULTS.image.h;
      const s = Math.min(1, MAX_EDGE / Math.max(nw, nh));
      const w = Math.max(48, Math.round(nw * s)), h = Math.max(48, Math.round(nh * s));
      // Drop/paste position if given, else the visible centre.
      let center = at;
      if (!center) {
        center = { x: 200, y: 200 };
        try {
          const el = document.querySelector(".react-flow");
          if (el) {
            const r = el.getBoundingClientRect();
            center = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }
        } catch { /* */ }
      }
      const node = {
        id: freshId("image"),
        type: "image",
        position: { x: center.x - w / 2, y: center.y - h / 2 },
        width: w,
        height: h,
        data: { src: data.url, path: data.path, alt: file.name || "" },
      };
      setNodes((nds) =>
        nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat({ ...node, selected: true })
      );
    },
    [session?.user?.id, board?.id, rf, setNodes]
  );

  // Drag an image file from Finder onto the canvas → upload + place at the drop.
  const onWbDragOver = useCallback((e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const onWbDrop = useCallback(
    (e) => {
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      let at;
      try { at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch { /* */ }
      addImageNode(file, at);
    },
    [rf, addImageNode]
  );

  // Paste: an image in the clipboard becomes an image node; otherwise paste the
  // in-app node clipboard. Cmd/Ctrl+V lives here (not the keydown handler) since
  // only the paste event exposes clipboard contents.
  useEffect(() => {
    function onPaste(e) {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const boardEl = mainRef.current;
      if (!boardEl || !(boardEl.matches(":hover") || boardEl.contains(el))) return;
      const items = e.clipboardData?.items;
      const imgItem = items && [...items].find((it) => it.kind === "file" && it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) { e.preventDefault(); addImageNode(file, lastPtRef.current); return; }
      }
      e.preventDefault();
      pasteRef.current?.(lastPtRef.current);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageNode]);

  // Double-click empty canvas → drop a text node at the cursor, ready to type.
  // Gated to the pane itself so double-clicking a node still just edits it.
  const onPaneDoubleClick = useCallback(
    (e) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.classList.contains("react-flow__pane")) return;
      let pos;
      try {
        pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      } catch {
        return;
      }
      const size = DEFAULTS.text;
      const id = freshId("text");
      markNodeForEdit(id); // open straight into edit
      setNodes((nds) =>
        nds
          .map((n) => (n.selected ? { ...n, selected: false } : n))
          .concat({
            id,
            type: "text",
            position: { x: pos.x - size.w / 2, y: pos.y - size.h / 2 },
            data: { text: "", ...textStyleRef.current },
            selected: true,
          })
      );
    },
    [rf, setNodes]
  );

  // Drop all selection (nodes + edges) without deleting anything — used by the
  // quick palette's centre "X" to bail back to a clean select state.
  const clearSelection = useCallback(() => {
    setNodes((nds) => (nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds));
    setEdges((eds) => (eds.some((e) => e.selected) ? eds.map((e) => (e.selected ? { ...e, selected: false } : e)) : eds));
  }, [setNodes, setEdges]);

  const deleteSelected = useCallback(() => {
    const selectedNodeIds = new Set(
      nodes.filter((n) => n.selected).map((n) => n.id)
    );
    const selectedEdgeIds = new Set(
      edges.filter((e) => e.selected).map((e) => e.id)
    );
    if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
    setNodes((nds) =>
      nds.filter((n) => !selectedNodeIds.has(n.id) && n.type !== "zone")
    );
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !selectedEdgeIds.has(e.id) &&
          !selectedNodeIds.has(e.source) &&
          !selectedNodeIds.has(e.target)
      )
    );
  }, [nodes, edges, setNodes, setEdges]);

  // Clone nodes (pulling in any framed children + edges fully inside the
  // selection), offset a touch and left selected. Powers ⌘/Ctrl-click on a
  // node and ⌘/Ctrl-D on the selection. Offset is grid-aligned so clones stay
  // tidy.
  const cloneNodes = useCallback((ids, dx = 32, dy = 32) => {
    const { src, idMap } = collectCloneSources(rf.getNodes(), ids);
    if (!src.length) return;
    const clones = src.map((n) => {
      const childOfCloned = n.parentId && idMap.has(n.parentId);
      const next = { ...n, id: idMap.get(n.id), data: { ...n.data }, selected: true };
      if (childOfCloned) {
        next.parentId = idMap.get(n.parentId);          // re-parent to the cloned frame
        next.position = { ...n.position };               // relative to parent → keep
      } else {
        next.position = { x: n.position.x + dx, y: n.position.y + dy };
      }
      return next;
    });
    setNodes((nds) =>
      nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(clones)
    );
    setEdges((eds) => duplicateInternalEdges(eds, idMap));
  }, [rf, setNodes, setEdges]);
  // Ref so the keydown handler (subscribed once) can call the latest clone fn.
  const cloneRef = useRef(null);
  cloneRef.current = cloneNodes;

  // Toggle MY dot-vote on a node (per-user map in data.votes). Syncs/persists
  // like any node edit; clears the key (and the whole map when empty) to keep
  // data lean. See VotesOverlay.
  const toggleVote = useCallback((nodeId) => {
    const myId = session?.user?.id;
    if (!myId) return;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const votes = { ...(n.data?.votes || {}) };
      if (votes[myId]) delete votes[myId]; else votes[myId] = 1;
      return { ...n, data: { ...n.data, votes: Object.keys(votes).length ? votes : undefined } };
    }));
  }, [session?.user?.id, setNodes]);

  // Node comments (data.comments — synced/persisted like any node data). One
  // thread open at a time, anchored to the node via NodeToolbar.
  const [openCommentId, setOpenCommentId] = useState(null);
  const addComment = useCallback((nodeId, text) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const c = { id: freshId("c"), authorId: session?.user?.id, author: myName, text, ts: Date.now() };
      return { ...n, data: { ...n.data, comments: [...(n.data?.comments || []), c] } };
    }));
  }, [session?.user?.id, myName, setNodes]);
  const deleteComment = useCallback((nodeId, commentId) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const comments = (n.data?.comments || []).filter((c) => c.id !== commentId);
      return { ...n, data: { ...n.data, comments: comments.length ? comments : undefined } };
    }));
  }, [setNodes]);
  // Auto-close the comment thread on click-away (anywhere but the thread or a
  // comment badge — the badge handles its own toggle/switch) and on Escape.
  useEffect(() => {
    if (!openCommentId) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t instanceof Element && (t.closest(".wb-comment-thread") || t.closest(".wb-comment-badge"))) return;
      setOpenCommentId(null);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpenCommentId(null); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openCommentId]);

  // Alt/Option-drag = clone: at drag start, drop a copy of the dragged node(s)
  // in place (unselected) and let the ORIGINALS keep dragging — so you pull a
  // clean duplicate out while the copy left behind KEEPS all the connections
  // (the original position looks untouched). Guarded so we clone once per drag.
  const altCloningRef = useRef(false);
  const onNodeDragStartClone = useCallback((event, node) => {
    const alt = event?.altKey ?? event?.sourceEvent?.altKey;
    if (!alt || altCloningRef.current) return;
    altCloningRef.current = true;
    const all = rf.getNodes();
    const ids = node.selected
      ? all.filter((n) => n.selected && n.type !== "zone").map((n) => n.id)
      : [node.id];
    const { src, idMap } = collectCloneSources(all, ids);
    if (!src.length) return;
    const clones = src.map((n) => {
      const next = { ...n, id: idMap.get(n.id), data: { ...n.data }, selected: false, dragging: false };
      if (n.parentId && idMap.has(n.parentId)) next.parentId = idMap.get(n.parentId);
      next.position = { ...n.position }; // SAME spot — the copy stays put
      return next;
    });
    setNodes((nds) => nds.concat(clones));
    setEdges((eds) => {
      // Internal edges (both ends cloned): give the stay-put clones their own
      // copy so the clone group keeps its wiring, and leave the originals' copy
      // intact so the dragged-out duplicate stays internally connected too.
      const copies = eds
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e, id: freshId("e"), selected: false,
          source: idMap.get(e.source), target: idMap.get(e.target),
          data: e.data ? { ...e.data } : e.data,
        }));
      // External edges (one end cloned): re-point that end onto the clone that
      // stays put, so the ORIGINAL spot keeps its connections and the copy you
      // drag away comes out clean. (This is the fix: edges no longer follow the
      // node you're dragging.)
      const rewired = eds.map((e) => {
        const s = idMap.has(e.source);
        const t = idMap.has(e.target);
        if (s === t) return e; // internal (both) or untouched (neither) — leave as-is
        return {
          ...e,
          source: s ? idMap.get(e.source) : e.source,
          target: t ? idMap.get(e.target) : e.target,
        };
      });
      return rewired.concat(copies);
    });
  }, [rf, setNodes, setEdges]);

  // ── copy / cut / paste ──────────────────────────────────────────────
  // Mirrors cloneNodes' id-remap + frame-children + internal-edges handling,
  // but routed through the in-app clipboard so it works across boards/tabs.
  // Returns whether anything was copied (so the keydown handler knows whether
  // to swallow the key vs. let the browser copy text).
  const copySelection = useCallback(() => {
    const all = rf.getNodes();
    const sel = new Set(all.filter((n) => n.selected && n.type !== "zone").map((n) => n.id));
    if (!sel.size) return false;
    for (const n of all) if (n.parentId && sel.has(n.parentId)) sel.add(n.id); // frame children ride along
    const clipNodes = all
      .filter((n) => sel.has(n.id))
      .map(({ selected, dragging, resizing, ...rest }) => rest);
    const clipEdges = rf
      .getEdges()
      .filter((e) => sel.has(e.source) && sel.has(e.target)) // edges fully inside the selection
      .map(({ selected, ...rest }) => rest);
    writeWbClipboard({ nodes: clipNodes, edges: clipEdges });
    return true;
  }, [rf]);

  const pasteClipboard = useCallback((at) => {
    const clip = readWbClipboard();
    if (!clip?.nodes?.length) return;
    const idMap = new Map(clip.nodes.map((n) => [n.id, freshId(n.type || "paste")]));
    const isChild = (n) => n.parentId && idMap.has(n.parentId);
    // Drop the cluster under the cursor (or its original spot +offset if we
    // have no pointer yet). Top-level nodes carry absolute positions; framed
    // children stay relative to their (also-pasted) frame.
    const tops = clip.nodes.filter((n) => !isChild(n));
    let dx = 32, dy = 32;
    if (at && tops.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of tops) {
        const x = n.position?.x ?? 0, y = n.position?.y ?? 0;
        const w = n.width ?? n.measured?.width ?? 0, h = n.height ?? n.measured?.height ?? 0;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      }
      dx = at.x - (minX + maxX) / 2;
      dy = at.y - (minY + maxY) / 2;
    }
    const pasted = clip.nodes.map((n) => {
      const next = { ...n, id: idMap.get(n.id), data: { ...n.data }, selected: true };
      if (isChild(n)) {
        next.parentId = idMap.get(n.parentId);   // re-parent to the pasted frame
        next.position = { ...n.position };         // relative → keep
      } else {
        if ("parentId" in next) delete next.parentId; // frame not in the paste → unparent
        next.position = { x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy };
      }
      return next;
    });
    setNodes((nds) =>
      nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(pasted)
    );
    const pastedEdges = (clip.edges || [])
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        ...e,
        id: freshId("e"),
        selected: false,
        source: idMap.get(e.source),
        target: idMap.get(e.target),
        data: e.data ? { ...e.data } : e.data, // anchors are node-relative; route re-bases off the new ends
      }));
    if (pastedEdges.length) setEdges((eds) => eds.concat(pastedEdges));
  }, [rf, setNodes, setEdges]);

  const cutSelection = useCallback(() => {
    if (!copySelection()) return false;
    deleteSelected();
    return true;
  }, [copySelection, deleteSelected]);

  const copyRef = useRef(null); copyRef.current = copySelection;
  const cutRef = useRef(null); cutRef.current = cutSelection;
  const pasteRef = useRef(null); pasteRef.current = pasteClipboard;

  // ⌘/Ctrl-click a node to drop a clone of it right next to it.
  const onNodeClick = useCallback((e, node) => {
    if ((e.metaKey || e.ctrlKey) && node.type !== "zone") {
      e.preventDefault();
      e.stopPropagation();
      cloneNodes([node.id]);
      return;
    }
    // Touch: guarantee one tap = selected. RF's own tap selection has been
    // flaky on mobile (took a second tap); force it from the click.
    if (WB_TOUCH && node.type !== "zone" && !node.selected) {
      setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, selected: true } : n.selected ? { ...n, selected: false } : n)));
    }
  }, [cloneNodes, setNodes]);

  // ── selection inspector ──
  const selectedNode = useMemo(
    () => nodes.find((n) => n.selected && n.type !== "zone") || null,
    [nodes]
  );
  // Only show the per-item inspector for a SINGLE selection — a marquee
  // multi-select shouldn't stack toolbars over the canvas.
  const singleSelection = useMemo(() => {
    let c = 0;
    for (const n of nodes) if (n.selected && n.type !== "zone") { if (++c > 1) return false; }
    for (const e of edges) if (e.selected) { if (++c > 1) return false; }
    return c === 1;
  }, [nodes, edges]);
  const selectedEdge = useMemo(
    () => (selectedNode ? null : edges.find((e) => e.selected) || null),
    [edges, selectedNode]
  );
  // Top-level selected nodes (framed children skipped — their coords are
  // parent-relative). 2+ surfaces the align/distribute toolbar.
  const multiCount = useMemo(
    () => nodes.filter((n) => n.selected && n.type !== "zone" && !n.parentId).length,
    [nodes]
  );
  const touchInspectorVisible = !!(selectedNode && singleSelection && WB_TOUCH);
  const bottomStackOffset = 15 + toolbarH + BOTTOM_PANEL_GAP;
  const brushStackH = tool === "brush" ? PAINT_TOOLBAR_STACK_H : 0;
  const touchInspectorBottom = bottomStackOffset + brushStackH;
  const touchInspectorStackH = touchInspectorVisible ? touchInspectorH + BOTTOM_PANEL_GAP : 0;
  const emoteBarOffset = toolbarH + 11 + brushStackH + touchInspectorStackH;
  useEffect(() => {
    if (!touchInspectorVisible) return;
    // Portaled inspector dropdowns read this to open just above the bar.
    document.documentElement.style.setProperty(
      "--wb-inspector-clear",
      `${touchInspectorBottom + touchInspectorH + 8}px`,
    );
  }, [touchInspectorVisible, touchInspectorBottom, touchInspectorH]);

  // Align / distribute the selected top-level nodes by their bounding boxes.
  const arrange = useCallback(
    (op) => {
      setNodes((nds) => {
        const sel = nds.filter((n) => n.selected && n.type !== "zone" && !n.parentId);
        if (sel.length < 2) return nds;
        const rs = sel.map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? n.width ?? 0,
          h: n.measured?.height ?? n.height ?? 0,
        }));
        const minX = Math.min(...rs.map((r) => r.x));
        const maxR = Math.max(...rs.map((r) => r.x + r.w));
        const minY = Math.min(...rs.map((r) => r.y));
        const maxB = Math.max(...rs.map((r) => r.y + r.h));
        const cX = (minX + maxR) / 2, cY = (minY + maxB) / 2;
        const pos = new Map();
        for (const r of rs) {
          let { x, y } = r;
          if (op === "left") x = minX;
          else if (op === "right") x = maxR - r.w;
          else if (op === "centerH") x = cX - r.w / 2;
          else if (op === "top") y = minY;
          else if (op === "bottom") y = maxB - r.h;
          else if (op === "middleV") y = cY - r.h / 2;
          pos.set(r.id, { x, y });
        }
        if (op === "distH" || op === "distV") {
          const horiz = op === "distH";
          const sorted = [...rs].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
          const span = horiz ? maxR - minX : maxB - minY;
          const used = sorted.reduce((s, r) => s + (horiz ? r.w : r.h), 0);
          const gap = (span - used) / (sorted.length - 1);
          let cursor = horiz ? minX : minY;
          for (const r of sorted) {
            pos.set(r.id, horiz ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
            cursor += (horiz ? r.w : r.h) + gap;
          }
        }
        // Match-size: set every selected node's width / height to the largest.
        const size = new Map();
        if (op === "matchW" || op === "matchH") {
          const dim = op === "matchW" ? "w" : "h";
          const target = Math.max(...rs.map((r) => r[dim]));
          for (const r of rs) size.set(r.id, op === "matchW" ? { width: target } : { height: target });
        }
        return nds.map((n) => {
          if (size.has(n.id)) return { ...n, ...size.get(n.id) };
          if (pos.has(n.id)) return { ...n, position: { ...n.position, ...pos.get(n.id) } };
          return n;
        });
      });
    },
    [setNodes]
  );

  const patchNodeData = useCallback(
    (patch) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.selected && n.type !== "zone"
            ? { ...n, data: { ...n.data, ...patch } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Lock / unlock the selected node(s). React Flow's per-node `draggable:false`
  // stops the move; the resizer is hidden via data.locked in each node. Both
  // persist (snapshot + sync), so a lock is shared with everyone on the board.
  const setSelectedLocked = useCallback(
    (locked) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.selected && n.type !== "zone"
            ? { ...n, draggable: locked ? false : undefined, data: { ...n.data, locked } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Per-node opacity via React Flow's node.style (persists + syncs). 1 clears it.
  const setSelectedOpacity = useCallback(
    (opacity) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.selected && n.type !== "zone"
            ? { ...n, style: { ...(n.style || {}), opacity: opacity >= 1 ? undefined : opacity } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Z-order: stacking follows array order (later = on top). Move the selection
  // to the end (front) or start (back); sortParentsFirst is a stable sort so it
  // only re-pins frames ahead of their children, keeping the new order. Persists
  // in the snapshot; live-syncs on the next reload (order isn't a per-entity op).
  const reorderSelected = useCallback(
    (toFront) => {
      setNodes((nds) => {
        const selIds = new Set(nds.filter((n) => n.selected && n.type !== "zone").map((n) => n.id));
        if (!selIds.size) return nds;
        const sel = nds.filter((n) => selIds.has(n.id));
        const rest = nds.filter((n) => !selIds.has(n.id));
        return sortParentsFirst(toFront ? [...rest, ...sel] : [...sel, ...rest]);
      });
    },
    [setNodes]
  );

  // Title / goal / archive — same flow as the prior page, just leaning
  // on the existing setters in lib/whiteboard.
  async function handleSaveTitle() {
    if (!board) return;
    const next = titleDraft.trim() || "Untitled whiteboard";
    const { error: err } = await setWhiteboardTitle(board.id, next);
    if (err) {
      setError(err.message || "Couldn't save title.");
      return;
    }
    setBoard((b) => (b ? { ...b, title: next } : b));
    setTitleEditing(false);
  }
  async function handleSaveGoal() {
    if (!board) return;
    const next = goalDraft.trim();
    const { error: err } = await setWhiteboardGoal(board.id, next);
    if (err) {
      setError(err.message || "Couldn't save goal.");
      return;
    }
    setBoard((b) => (b ? { ...b, goal: next } : b));
    setGoalEditing(false);
  }
  async function handleArchive() {
    if (!board) return;
    if (
      !window.confirm(
        "Archive this whiteboard? It'll disappear from the list — you can restore later."
      )
    )
      return;
    const { error: err } = await archiveWhiteboard(board.id);
    if (err) {
      setError(err.message || "Couldn't archive.");
      return;
    }
    navigate("/whiteboards");
  }

  // Render a flow-coordinate region to a PNG and download it. We capture React
  // Flow's viewport element with an overridden transform that frames `bounds` (so
  // the export covers that area, not just what's on screen). html-to-image clones
  // the node, so the live view isn't disturbed. Shared by the whole-board export
  // (bounds = all nodes) and the region-capture tool (bounds = the dragged box).
  const exportPng = useCallback(async (bounds, pad = 48) => {
    const el = mainRef.current?.querySelector(".react-flow__viewport");
    if (!el) return;
    if (!bounds || !bounds.width || !bounds.height) { setError("Nothing to export yet."); return; }
    // Up to 2x for crisp small regions; scale down big ones to cap ~4000px.
    const zoom = Math.min(2, 4000 / Math.max(bounds.width, bounds.height));
    const w = Math.ceil(bounds.width * zoom + pad * 2);
    const h = Math.ceil(bounds.height * zoom + pad * 2);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        backgroundColor: dark ? "#0f172a" : "#fbf6ee",
        width: w,
        height: h,
        pixelRatio: 1,
        cacheBust: true,
        style: {
          width: `${w}px`,
          height: `${h}px`,
          transform: `translate(${pad - bounds.x * zoom}px, ${pad - bounds.y * zoom}px) scale(${zoom})`,
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(board?.title || "whiteboard").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "whiteboard"}.png`;
      a.click();
    } catch (e) {
      setError(`Export failed: ${e?.message || "unknown error"}`);
    }
  }, [dark, board?.title]);

  // Whole-board export: frame the bounding box of every node.
  const handleExportPng = useCallback(() => {
    exportPng(getNodesBounds(rf.getNodes()), 48);
  }, [exportPng, rf]);

  const template = useMemo(
    () => (board?.template_key ? TEMPLATES[board.template_key] : null),
    [board?.template_key]
  );

  // ── early returns ──
  const frameCls = embedded
    ? "w-full h-full p-4 space-y-3"
    // Phones: edge-to-edge — the editor is viewport-height, so any page
    // padding overflows below the canvas as a dead band / pushes content
    // under the tab bar. The card look starts at sm.
    : "max-w-[1400px] mx-auto sm:px-4 sm:pt-6 sm:pb-6 sm:space-y-3";
  if (loading) {
    return (
      <main className={frameCls}>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[640px] w-full" />
      </main>
    );
  }
  if (!board) {
    return (
      <main className={frameCls}>
        {!embedded && (
          <Link
            to="/whiteboards"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to whiteboards
          </Link>
        )}
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {error || "Whiteboard not found, or you don't have access."}
        </p>
      </main>
    );
  }

  const saveLabel =
    saveState === "saved"
      ? "Saved"
      : saveState === "saving"
      ? "Saving…"
      : saveState === "dirty"
      ? "Unsaved"
      : "";

  return (
    <main
      ref={mainRef}
      // Subtract the nav bar (--nav-h; taller on mobile's two-row header) AND
      // both safe-area insets. Without the top env() the canvas is ~59px too tall on Dynamic
      // Island phones (top timer ribbon hides under the nav, bottom emote
      // island falls below the fold). The bottom env() keeps the bottom
      // controls (emote bar, zoom controls) clear of the home-indicator /
      // gesture area so taps there don't trigger an OS swipe. env() = 0 on
      // desktop, so it's a no-op there.
      className={`relative w-full overflow-hidden ${
        tool === "pen" ? "wb-pen " : tool === "brush" ? "wb-paint " : ""
      }${
        embedded
          ? "h-full"
          : "h-[calc(100dvh-var(--nav-h)-var(--top-inset)-var(--bottom-inset))]"
      }`}
      onPointerMove={onWbPointerMove}
      onPointerDownCapture={(e) => { marqueePointerDown(e); onWbPointerDownCapture(e); }}
      onPointerMoveCapture={marqueePointerMove}
      onPointerUpCapture={marqueePointerUp}
      onPointerCancelCapture={marqueePointerUp}
      onTouchStartCapture={blockSingleTouchInDraw}
      onTouchMoveCapture={blockSingleTouchInDraw}
      onClickCapture={onEditorClickCapture}
      onPointerUp={onWbPointerUp}
      onPointerCancel={onWbPointerUp}
    >
      <EdgeMarkerDefs />
      {marqueeRect && (
        <div
          className="fixed z-[60] pointer-events-none rounded-sm"
          style={{
            left: Math.min(marqueeRect.x0, marqueeRect.x1),
            top: Math.min(marqueeRect.y0, marqueeRect.y1),
            width: Math.abs(marqueeRect.x1 - marqueeRect.x0),
            height: Math.abs(marqueeRect.y1 - marqueeRect.y0),
            border: "1.5px dashed var(--color-accent)",
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
          }}
        />
      )}
      {/* The embedded (room) board now shows the full title-bar toolbar
          (export / capture / save-template / reactions), at parity with the
          full page — so the old standalone top-right PNG button is gone. */}
      <QuickConnectContext.Provider value={quickConnectApi}>
      <ConnectShapeContext.Provider value={pickedShape}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeSnap}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectOnClick={false}
        onReconnect={onReconnect}
        onNodeDragStart={onNodeDragStartClone}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onDoubleClick={tool === "select" ? onPaneDoubleClick : undefined}
        onMoveEnd={(_, vp) => { if (!embedded) saveViewport(board?.id, vp); }}
        onDragOver={onWbDragOver}
        onDrop={onWbDrop}
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={ConnectionLine}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        // Laser mode is point-only: no selecting, dragging, or connecting — so
        // you can gesture over the board without disturbing it.
        nodesDraggable={tool === "select"}
        nodesConnectable={tool === "select"}
        elementsSelectable={tool === "select"}
        // Touch: one-finger drag PANS and pinch stays a clean zoom; area
        // select is long-press-then-drag (the custom marquee above). Desktop
        // keeps RF's left-drag marquee.
        selectionOnDrag={WB_TOUCH ? false : tool === "select"}
        selectionMode={SelectionMode.Partial}
        // Shift adds to selection, freeing ⌘/Ctrl for the click-to-clone quick action.
        multiSelectionKeyCode="Shift"
        // Zoom way out for big boards (default floor is 0.5); a bit more in too.
        minZoom={0.1}
        maxZoom={3}
        // Desktop: left-drag is reserved (marquee in select, draw in pen), so
        // panning is middle/right-drag — plus the activation key below. Touch:
        // in select mode one-finger drag pans; every other tool keeps the
        // finger for its own gesture (pen/laser/brush strokes).
        panOnDrag={WB_TOUCH && tool === "select" ? true : [1, 2]}
        // Trackpad: two-finger scroll pans, pinch zooms (ctrl/⌘+scroll too);
        // hold Space to drag-pan. Left-drag still marquee-selects.
        panOnScroll
        zoomOnScroll={false}
        // Touch draw modes: single-finger touches never reach d3 (see the
        // onTouchStartCapture block on the container), so one finger draws
        // while two-finger gestures still pinch-zoom/pan the canvas.
        zoomOnPinch
        // Hold to pan with a left-drag: Space everywhere; in laser/brush mode
        // also ⌘/Ctrl so you can move the canvas while the left button draws.
        panActivationKeyCode={tool === "laser" || tool === "brush" ? ["Space", "Control", "Meta"] : "Space"}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: dark ? "#0f172a" : "#fbf6ee" }}
      >
        <Background
          gap={26}
          size={1.6}
          color={dark ? "rgba(255,255,255,.06)" : "rgba(120,80,20,.14)"}
        />
        {/* Tiled raster paint layer (collaborative; strokes sync as vectors,
            tiles persist to Storage). High z so paint sits over nodes/images. */}
        <PaintLayer ref={paintRef} boardId={board?.id} enabled={collabEnabled} zIndex={900} />
        {(helperLines.vertical || helperLines.horizontal) && (
          <HelperLines
            vertical={helperLines.vertical}
            horizontal={helperLines.horizontal}
          />
        )}
        {/* No floating <Controls> — pinch/scroll zoom, and fit-view lives in
            the top chrome card. */}
        {/* Hidden on phones (hidden sm:block) — the minimap eats scarce screen
            on mobile and duplicates the top bar's fit-view. Embedded room
            tiles keep it (staging enables it there). */}
        {(!compact || embedded) && showMinimap && <MiniMap pannable zoomable position="bottom-right" className="hidden sm:block" />}
        <CollabCursors peers={peers} />
        <PresenceStack members={members} dark={dark} />

        {/* Dot-voting tally badges (per-node, multiplayer). */}
        <VotesOverlay nodes={nodes} myId={session?.user?.id} onToggle={toggleVote} dark={dark} />

        {/* Comment indicator badges (per-node, multiplayer). */}
        <CommentsOverlay nodes={nodes} openId={openCommentId} onOpen={setOpenCommentId} dark={dark} />

        {/* My own fading laser-ink trail (flow space). */}
        {tool === "laser" && <LaserTrail pointsRef={laserInkRef} color={effectiveLaserColor} />}

        {/* Live preview of the freehand stroke in progress (flow space). */}
        {drawPath && (
          <ViewportPortal>
            <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 6 }}>
              <path
                d={drawPath}
                fill="none"
                stroke={penStyle.color}
                strokeWidth={penStyle.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </ViewportPortal>
        )}

        {/* Paint toolbar — brush/eraser, colour, size, opacity (brush mode). */}
        {tool === "brush" && <PaintToolbar dark={dark} style={brushStyle} setStyle={setBrushStyle} bottomOffset={bottomStackOffset} />}

        {/* Align / distribute toolbar — only with 2+ top-level nodes selected. */}
        {multiCount >= 2 && (
          <Panel
            position="top-center"
            className={`flex items-center gap-0.5 px-1.5 py-1 rounded-xl border shadow-lg ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
          >
            {[
              ["left", AlignStartVertical, "Align left"],
              ["centerH", AlignCenterVertical, "Align centers (horizontal)"],
              ["right", AlignEndVertical, "Align right"],
              null,
              ["top", AlignStartHorizontal, "Align top"],
              ["middleV", AlignCenterHorizontal, "Align middles (vertical)"],
              ["bottom", AlignEndHorizontal, "Align bottom"],
              null,
              ["distH", AlignHorizontalDistributeCenter, "Distribute horizontally"],
              ["distV", AlignVerticalDistributeCenter, "Distribute vertically"],
              null,
              ["matchW", StretchHorizontal, "Match width"],
              ["matchH", StretchVertical, "Match height"],
            ].map((item, i) => {
              if (!item) return <div key={`d${i}`} className={`w-px h-5 mx-0.5 ${dark ? "bg-white/10" : "bg-slate-200"}`} />;
              const [op, Icon, title] = item;
              return (
                <button
                  key={op}
                  type="button"
                  title={title}
                  onClick={() => arrange(op)}
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                    dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </Panel>
        )}

        {/* Bottom-left so collapsing the toolbar keeps it anchored to the left
            edge instead of drifting to centre. Capped to the FLOW CONTAINER
            width (100% — a React Flow Panel is positioned within it), so an
            embedded room panel scrolls the rail instead of clipping it; w-max
            sizes to content up to that cap. */}
        <Panel position="bottom-left" className="w-max max-w-[calc(100%-16px)]">
          <div
            ref={toolbarRef}
            className={`wb-scroll-x flex flex-row flex-nowrap items-center gap-0.5 p-1 rounded-2xl border shadow-sm w-max max-w-full overflow-x-auto ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                : "bg-white border-slate-200"
            }`}
          >
          {/* Collapse the toolbar (press Q for the quick-tool palette). */}
          <button
            type="button"
            onClick={() => setToolbarOpen((v) => !v)}
            title={toolbarOpen ? "Hide toolbar · press Q for quick tools" : "Show toolbar"}
            aria-label={toolbarOpen ? "Hide toolbar" : "Show toolbar"}
            aria-pressed={toolbarOpen}
            className={`w-8 h-7 rounded-lg inline-flex items-center justify-center transition-colors ${
              dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {toolbarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          {toolbarOpen && (
          <div className="flex flex-row flex-nowrap items-center gap-0.5">
          <StickyTool
            dark={dark}
            onAdd={(hex) =>
              addNodeAtCenter("sticky", hex ? { color: hex } : {})
            }
            onDropAt={(x, y, hex) =>
              addNodeAtCenter("sticky", hex ? { color: hex } : {}, { x, y })
            }
          />
          <TextTool
            dark={dark}
            prefs={textStyle}
            setPrefs={setTextStyle}
            onAdd={() => addNodeAtCenter("text", textStyleRef.current)}
          />
          {!compact && (
            <div
              className={`w-px h-5 mx-0.5 ${
                dark ? "bg-[var(--color-border)]" : "bg-slate-200"
              }`}
            />
          )}
          <ShapesMenu
            dark={dark}
            onPick={(shape) => addNodeAtCenter("shape", { shape })}
            onDropAt={(x, y, shape) => addNodeAtCenter("shape", { shape }, { x, y })}
          />
          <ToolButton
            title="Add goal"
            tone="amber"
            dark={dark}
            onClick={() => addNodeAtCenter("goal")}
          >
            <Target className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            title="Add frame / section"
            tone="neutral"
            dark={dark}
            onClick={() => addNodeAtCenter("frame")}
          >
            <Frame className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            title={uploadingImage ? "Uploading image…" : "Add image"}
            tone="neutral"
            dark={dark}
            onClick={() => !uploadingImage && fileInputRef.current?.click()}
          >
            <ImagePlus className={`w-4 h-4 ${uploadingImage ? "animate-pulse opacity-60" : ""}`} />
          </ToolButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ""; // allow re-picking the same file
              if (f) addImageNode(f);
            }}
          />
          {!compact && (
            <div
              className={`w-px h-5 mx-0.5 ${
                dark ? "bg-[var(--color-border)]" : "bg-slate-200"
              }`}
            />
          )}
          <PenTool
            dark={dark}
            active={tool === "pen"}
            style={penStyle}
            setStyle={setPenStyle}
            onToggle={() => setTool((t) => (t === "pen" ? "select" : "pen"))}
          />
          <ToolButton
            title={tool === "brush" ? "Brush (on) — Esc to exit" : "Brush — raster paint (options in the top bar)"}
            tone="sky"
            dark={dark}
            active={tool === "brush"}
            onClick={() => setTool((t) => (t === "brush" ? "select" : "brush"))}
          >
            <Paintbrush className="w-4 h-4" />
          </ToolButton>
          <LaserTool
            dark={dark}
            active={tool === "laser"}
            color={effectiveLaserColor}
            setColor={setLaserColor}
            onToggle={() => setTool((t) => (t === "laser" ? "select" : "laser"))}
          />
          {!compact && (
            <div
              className={`w-px h-5 mx-0.5 ${
                dark ? "bg-[var(--color-border)]" : "bg-slate-200"
              }`}
            />
          )}
          <ToolButton
            title="Delete selected"
            tone="red"
            dark={dark}
            onClick={deleteSelected}
          >
            <Trash2 className="w-4 h-4" />
          </ToolButton>
          </div>
          )}
          </div>
        </Panel>

        {/* Node inspector (shape/fill/border/text) hovers above the
              selected node, like the edge toolbar. Edges use their own
              floating contextual toolbar (rendered on the edge itself). */}
        {selectedNode && singleSelection && !WB_TOUCH && (
          <NodeToolbar
            nodeId={selectedNode.id}
            isVisible
            // Text nodes put the format panel BELOW so opening the font/size
            // menus doesn't cover the text you're editing. Everything else keeps
            // the toolbar above.
            position={selectedNode.type === "text" ? Position.Bottom : Position.Top}
            // Frames carry a floating label above their top edge — push the
            // toolbar above THAT (like the edge toolbar clears the line) so it
            // never overlaps the title.
            offset={selectedNode.type === "frame" ? (selectedNode.data?.fontSize ?? 20) + 28 : 14}
            align="center"
          >
            <Inspector node={selectedNode} patchNodeData={patchNodeData} setLocked={setSelectedLocked} onReorder={reorderSelected} setOpacity={setSelectedOpacity} />
          </NodeToolbar>
        )}

        {/* Touch: the hovering NodeToolbar is fiddly on a phone — a static
            bar above the main toolbar instead, with taller targets and
            flyouts opening upward. */}
        {touchInspectorVisible && (
          <Panel position="bottom-left" className="w-max max-w-[calc(100%-16px)] z-40" style={{ bottom: touchInspectorBottom }}>
            <div ref={touchInspectorRef} className="flex items-center gap-1.5 max-w-full">
              {/* The pill scrolls (capped to the flow container so a room panel
                  doesn't clip it); the trash stays pinned outside it. */}
              <div className="wb-scroll-x overflow-x-auto rounded-xl max-w-[calc(100%-56px)] [&_button]:min-h-11 [&_.lucide]:w-5 [&_.lucide]:h-5">
                <DropUpContext.Provider value={true}>
                  <Inspector wrapBar node={selectedNode} patchNodeData={patchNodeData} setLocked={setSelectedLocked} onReorder={reorderSelected} setOpacity={setSelectedOpacity} />
                </DropUpContext.Provider>
              </div>
              <button
                type="button"
                onClick={deleteSelected}
                aria-label="Delete selected"
                className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center text-red-400 shadow-2xl active:bg-white/10"
                style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,.08)" }}
              >
                <Trash2 className="w-6 h-6" />
              </button>
            </div>
          </Panel>
        )}

        {/* Comment thread popover, anchored to the right of the open node. */}
        {openCommentId && (() => {
          const cn = nodes.find((n) => n.id === openCommentId);
          if (!cn) return null;
          return (
            <NodeToolbar nodeId={openCommentId} isVisible position={Position.Right} align="start" offset={12}>
              <CommentThread
                comments={cn.data?.comments || []}
                myId={session?.user?.id}
                onAdd={(t) => addComment(openCommentId, t)}
                onDelete={(cid) => deleteComment(openCommentId, cid)}
                onClose={() => setOpenCommentId(null)}
                dark={dark}
              />
            </NodeToolbar>
          );
        })()}
      </ReactFlow>
      </ConnectShapeContext.Provider>
      </QuickConnectContext.Provider>

      {/* Shape-number legend — shown while dragging a connector or hovering a
          quick-connect arrow, so people know which number makes which shape.
          The current pick is highlighted. Desktop only — it's a keyboard hint
          (1–9), useless without a keyboard. */}
      {!WB_TOUCH && (connecting || hoveringArrow) && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-4 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border shadow-lg pointer-events-none ${
            dark ? "bg-[var(--color-surface)]/95 border-[var(--color-border)]" : "bg-white/95 border-slate-200"
          }`}
        >
          <span className={`text-[10px] font-semibold uppercase tracking-wide mr-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Press
          </span>
          {SHAPES.map((s, i) => {
            const num = i === 9 ? 0 : i + 1;
            const on = pickedShape === s.key;
            return (
              <span
                key={s.key}
                title={`${num} · ${s.label}`}
                className={`flex flex-col items-center gap-0.5 px-1 py-0.5 rounded-md ${
                  on ? "bg-[var(--color-accent)]/15" : ""
                }`}
              >
                <span className={`text-[9px] font-bold leading-none ${on ? "text-[var(--color-accent)]" : dark ? "text-slate-400" : "text-slate-500"}`}>
                  {num}
                </span>
                <ShapePreview shape={s.key} w={20} h={13} />
              </span>
            );
          })}
        </div>
      )}

      {/* Region capture ("snip") overlay — drag a box to export it as a PNG. */}
      {tool === "capture" && !readOnly && (
        <RegionCapture
          dark={dark}
          toFlow={(p) => rf.screenToFlowPosition(p)}
          onComplete={(b) => { setTool("select"); exportPng(b, 12); }}
          onCancel={() => setTool("select")}
        />
      )}

      {/* Quick-tool palette — popped by pressing "Q" at the cursor. A compact
          floating tool picker; new nodes spawn right where the palette sits (the
          cursor). The centre is an "X" that clears the selection and drops back
          to select mode. Works even when the left toolbar is collapsed. */}
      {palette && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setPalette(null)} aria-hidden />
          <div
            style={{ left: palette.x, top: palette.y }}
            className={`fixed z-[60] -translate-x-1/2 -translate-y-1/2 grid grid-cols-3 gap-1 p-2 rounded-2xl border shadow-2xl ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
            role="menu"
            aria-label="Quick tools"
          >
            {[
              { label: "Frame", icon: <Frame className="w-4 h-4" />, run: () => addNodeAtCenter("frame", {}, palette) },
              { label: "Sticky note", icon: <StickyNote className="w-4 h-4" />, run: () => addNodeAtCenter("sticky", {}, palette) },
              { label: "Text", icon: <Type className="w-4 h-4" />, run: () => addNodeAtCenter("text", textStyleRef.current, palette) },
              { label: "Goal", icon: <Target className="w-4 h-4" />, run: () => addNodeAtCenter("goal", {}, palette) },
              { label: "Clear selection", icon: <X className="w-5 h-5" />, center: true, run: () => { setTool("select"); clearSelection(); } },
              { label: "Image", icon: <ImagePlus className="w-4 h-4" />, run: () => fileInputRef.current?.click() },
              { label: "Pen", icon: <Pencil className="w-4 h-4" />, run: () => setTool("pen") },
              { label: "Brush", icon: <Paintbrush className="w-4 h-4" />, run: () => setTool("brush") },
              { label: "Shape", icon: <ShapePreview shape={preferredShape()} w={22} h={15} />, run: () => addNodeAtCenter("shape", { shape: preferredShape() }, palette) },
            ].map(({ label, icon, run, center }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                title={label}
                aria-label={label}
                onClick={() => { run(); setPalette(null); }}
                className={`w-10 h-10 rounded-xl inline-flex items-center justify-center transition-colors ${
                  center
                    ? (dark ? "text-rose-300 hover:bg-rose-500/15 ring-1 ring-rose-500/30" : "text-rose-500 hover:bg-rose-50 ring-1 ring-rose-200")
                    : (dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100")
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
        </>
      )}

      {/* My own laser glow (screen space) — tracks in laser mode, shows on press. */}
      <LocalLaser active={tool === "laser"} show={laserPressing} color={effectiveLaserColor} />
      {/* Photoshop-style brush ring while painting (replaces the crosshair). */}
      <BrushCursor active={tool === "brush"} size={brushStyle.size} color={brushStyle.color} erase={brushStyle.erase} />

      {/* Breadcrumb / board chrome — a floating card pinned top-left. Holds
            back-nav, title, template badge, save state, the reactions-bar
            toggle, and archive. The inner row flex-wraps on narrow phones (see
            below) so it folds to two rows instead of overflowing. */}
      <div className="absolute left-3 top-3 z-40 flex flex-col gap-2 items-start max-w-[calc(100%-24px)] touch-none">
        <div
          // flex-wrap so the toolbar folds onto a second row on narrow phones
          // instead of overflowing the canvas (every child is shrink-0). The
          // outer max-w-[calc(100%-24px)] caps the row width so the wrap fires.
          className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-2xl border shadow-md"
          style={{
            background: dark ? "var(--color-surface)" : "#fff",
            borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)",
          }}
        >
          {!embedded && (
            <>
              <Link
                to="/whiteboards"
                title="Back to whiteboards"
                className={`inline-flex items-center gap-1 text-xs shrink-0 ${
                  dark
                    ? "text-slate-400 hover:text-slate-200"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div
                className={`hidden sm:block w-px h-4 ${
                  dark ? "bg-[var(--color-border)]" : "bg-slate-200"
                }`}
              />
            </>
          )}
          {titleEditing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value.slice(0, 120))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  else if (e.key === "Escape") {
                    setTitleDraft(board.title);
                    setTitleEditing(false);
                  }
                }}
                className={`rounded-md border px-2 py-0.5 text-sm font-bold w-44 ${
                  dark
                    ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100"
                    : "bg-white border-slate-300 text-slate-800"
                }`}
              />
              <Button size="sm" onClick={handleSaveTitle} className="h-7">
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTitleDraft(board.title);
                  setTitleEditing(false);
                }}
                className="h-7"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <span
              className={`text-sm font-bold inline-flex items-center gap-1.5 cursor-text max-w-[220px] ${
                dark ? "text-slate-100" : "text-slate-800"
              }`}
              onDoubleClick={() => setTitleEditing(true)}
              title="Double-click to rename"
            >
              <span className="truncate">{board.title}</span>
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className={`opacity-50 hover:opacity-100 shrink-0 ${
                  dark ? "text-slate-300" : "text-slate-500"
                }`}
                title="Rename"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          {template && !compact && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)] shrink-0">
              {template.name}
            </span>
          )}
          {saveLabel && (
            <span
              className={`text-[11px] shrink-0 ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              {saveLabel}
            </span>
          )}
          <div
            className={`hidden sm:block w-px h-4 ${
              dark ? "bg-[var(--color-border)]" : "bg-slate-200"
            }`}
          />
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
              !canUndo
                ? dark ? "text-slate-600 cursor-not-allowed" : "text-slate-300 cursor-not-allowed"
                : dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
            className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
              !canRedo
                ? dark ? "text-slate-600 cursor-not-allowed" : "text-slate-300 cursor-not-allowed"
                : dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <FitViewButton dark={dark} />
          {/* Collapse / reveal the extra tools. Keeps the bar to one row on a
              small board; when open they wrap to a second row if narrow. */}
          <button
            type="button"
            onClick={() => setToolsOpen((v) => !v)}
            title={toolsOpen ? "Hide tools" : "Show tools"}
            aria-label={toolsOpen ? "Hide tools" : "Show tools"}
            aria-pressed={toolsOpen}
            className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
              toolsOpen
                ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]"
                : dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {toolsOpen && (
            <>
              <div
                className={`hidden sm:block w-px h-4 ${
                  dark ? "bg-[var(--color-border)]" : "bg-slate-200"
                }`}
              />
              <button
                type="button"
                onClick={() => setEmoteBarOn((v) => !v)}
                title={emoteBarOn ? "Hide reactions bar" : "Show reactions bar"}
                aria-label={
                  emoteBarOn ? "Hide reactions bar" : "Show reactions bar"
                }
                aria-pressed={emoteBarOn}
                className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                  emoteBarOn
                    ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]"
                    : dark
                    ? "text-slate-400 hover:bg-white/10"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowTimer((v) => !v)}
                title={showTimer ? "Hide timer" : "Show timer"}
                aria-label={showTimer ? "Hide timer" : "Show timer"}
                aria-pressed={showTimer}
                className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                  showTimer
                    ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]"
                    : dark
                    ? "text-slate-400 hover:bg-white/10"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Timer className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowMinimap((v) => !v)}
                title={showMinimap ? "Hide minimap" : "Show minimap"}
                aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
                aria-pressed={showMinimap}
                className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                  showMinimap
                    ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]"
                    : dark
                    ? "text-slate-400 hover:bg-white/10"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <MapIcon className="w-4 h-4" />
              </button>
              {!readOnly && (
            <button
              type="button"
              onClick={() => setTool((t) => (t === "capture" ? "select" : "capture"))}
              title="Capture a region as PNG"
              aria-label="Capture a region as PNG"
              aria-pressed={tool === "capture"}
              className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                tool === "capture"
                  ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]"
                  : dark
                  ? "text-slate-400 hover:bg-white/10"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Crop className="w-4 h-4" />
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={handleExportPng}
              title="Export as PNG"
              aria-label="Export as PNG"
              className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                dark
                  ? "text-slate-400 hover:bg-white/10"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setSaveTplOpen(true)}
              title="Save as template"
              aria-label="Save as template"
              className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                dark
                  ? "text-slate-400 hover:bg-white/10"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
          )}
          {isAdmin && !embedded && (
            <button
              type="button"
              onClick={handleArchive}
              title="Archive whiteboard"
              aria-label="Archive whiteboard"
              className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${
                dark
                  ? "text-slate-400 hover:bg-white/10"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
            </>
          )}
        </div>
        {error && (
          <div
            className={`text-xs font-medium px-3 py-1.5 rounded-lg shadow ${
              dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
            }`}
          >
            {error}
          </div>
        )}
        {/* Shared board countdown — stacked in the nav column (below the
              breadcrumb) so the two never overlap. It used to sit in the
              centered hero row and collided with the nav on narrow boards. */}
        {showTimer && <WhiteboardTimer boardId={board.id} dark={dark} />}

        <SaveTemplateModal
          open={saveTplOpen}
          onClose={() => setSaveTplOpen(false)}
          getSnapshot={() => ({ nodes, edges })}
          teamId={activeTeamId}
          ownerId={session?.user?.id}
          defaultName={board?.title}
        />
      </div>

      {/* Top overlay — Weekly Review's signature goal banner (when the
            template opts in), pinned top-center over the canvas. The focus
            timer now lives in the nav column (above), so this row holds the
            goal banner alone. pointer-events:none on the wrapper so clicks
            pass through except on the chip itself. */}
      {template?.hasGoal && !compact && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-3 z-30 flex items-stretch max-w-[calc(100%-32px)] touch-none"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex items-center gap-3 pl-3 pr-4 py-2 rounded-2xl shadow-md min-w-0 max-w-[520px]"
            style={{
              background:
                "linear-gradient(120deg, #f97316, #fb7a1a 70%, #ea580c)",
              boxShadow: "0 16px 34px -18px rgba(249,115,22,.65)",
              pointerEvents: "auto",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-white/20">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[8.5px] font-bold tracking-[0.13em] uppercase text-white/85">
                  Goal for next week
                </span>
                {!goalEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(board.goal || "");
                      setGoalEditing(true);
                    }}
                    className="text-white/75 hover:text-white"
                    title="Edit goal"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
              {goalEditing ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    autoFocus
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value.slice(0, 280))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveGoal();
                      else if (e.key === "Escape") {
                        setGoalDraft(board.goal || "");
                        setGoalEditing(false);
                      }
                    }}
                    placeholder="Write your team goal…"
                    className="flex-1 bg-white/15 rounded-md px-2 py-1 text-sm text-white placeholder-white/60 outline-none focus:bg-white/25"
                  />
                  <button
                    type="button"
                    onClick={handleSaveGoal}
                    className="h-7 px-2.5 rounded-md bg-white text-orange-700 text-xs font-bold"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(board.goal || "");
                      setGoalEditing(false);
                    }}
                    className="h-7 px-2.5 rounded-md bg-white/15 text-white text-xs font-bold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-[14px] font-bold tracking-tight text-white truncate max-w-[470px]">
                  {board.goal || "Click edit to set a goal…"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating-emote layer scoped to this whiteboard. Same scope
            key on every client → emotes broadcast peer-to-peer. The bar
            is toggleable; peers' emotes still render when it's hidden. */}
      <EmoteOverlay
        channelKey={`whiteboard:${board.id}`}
        barPosition={emoteBarOn ? "bottom-center" : "hidden"}
        // Sit just above whatever's stacked at bottom-center: the measured
        // toolbar (panel margin 15 + height + gap), plus any paint/inspector
        // bars stacked above it.
        barOffset={emoteBarOffset}
      />
    </main>
  );
}
