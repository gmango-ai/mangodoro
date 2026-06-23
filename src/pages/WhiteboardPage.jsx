import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
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
  Target,
  Pencil,
  Archive,
  Download,
  Type,
  Shapes,
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
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${active ? activeCls : tones[tone]}`}
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
function ShapesMenu({ dark, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title="Add shape"
        onClick={() => setOpen((v) => !v)}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          dark
            ? "text-sky-400 hover:bg-sky-500/15"
            : "text-sky-600 hover:bg-sky-50"
        }`}
      >
        <Shapes className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2 rounded-2xl border shadow-lg grid grid-cols-5 gap-1 ${
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
                title={s.label}
                onClick={() => {
                  onPick(s.key);
                  setOpen(false);
                }}
                className={`h-10 rounded-lg flex items-center justify-center ${
                  dark
                    ? "text-slate-300 hover:bg-white/10"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <ShapePreview shape={s.key} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Sticky tool for the rail. The button shows the current default color
// and adds a note in it; the corner caret opens a palette flyout to
// change the default (curated pastels + any custom hex). Picking a color
// sets it as the default AND drops a note in that color.
function StickyTool({ dark, onAdd }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() =>
    stickyHex(preferredStickyColor())
  );

  function pick(hex) {
    setPreferredStickyColor(hex);
    setCurrent(stickyHex(hex));
    onAdd(hex);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        title="Add sticky note"
        aria-label="Add sticky note"
        onClick={() => onAdd()}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
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
      <button
        type="button"
        title="Choose sticky color"
        aria-label="Choose sticky color"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow ${
          dark
            ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]"
            : "bg-white text-slate-500 border border-slate-200"
        }`}
      >
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2.5 rounded-2xl border shadow-lg ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                : "bg-white border-slate-200"
            }`}
            style={{ width: 188 }}
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
                  onClick={() => pick(hex)}
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
                onChange={(e) => pick(e.target.value)}
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
        </>
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
    <div className="relative">
      <button
        type="button"
        title="Add text"
        aria-label="Add text"
        onClick={() => onAdd()}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Type className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="New-text defaults"
        aria-label="New-text defaults"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow ${
          dark
            ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]"
            : "bg-white text-slate-500 border border-slate-200"
        }`}
      >
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-10 top-0 z-20 rounded-xl shadow-2xl overflow-hidden"
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
    <div className="relative">
      <button
        type="button"
        title={active ? "Pen (on) — Esc to exit" : "Pen — draw freehand"}
        aria-label="Pen"
        aria-pressed={active}
        onClick={onToggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          active
            ? dark ? "bg-sky-500/25 text-sky-300" : "bg-sky-100 text-sky-700"
            : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Pen options"
        aria-label="Pen options"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow ${
          dark
            ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]"
            : "bg-white text-slate-500 border border-slate-200"
        }`}
      >
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2.5 rounded-2xl border shadow-lg ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                : "bg-white border-slate-200"
            }`}
            style={{ width: 188 }}
          >
            <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Pen colour
            </div>
            <div className="grid grid-cols-6 gap-1">
              {PEN_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => setStyle((s) => ({ ...s, color: hex }))}
                  className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                  style={{
                    background: hex,
                    outline: style.color.toLowerCase() === hex.toLowerCase() ? "2px solid #f97316" : "none",
                    outlineOffset: 1,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
                  }}
                />
              ))}
            </div>
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
          </div>
        </>
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
    <div className="relative">
      <button
        type="button"
        title={active ? "Laser (on) — drag to draw a fading line, ⌘/Ctrl-drag to pan, Esc to exit" : "Laser pointer — point things out & underline"}
        aria-label="Laser pointer"
        aria-pressed={active}
        onClick={onToggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
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
        className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full shadow border-2"
        style={{ background: cur, borderColor: dark ? "var(--color-surface)" : "#fff" }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2.5 rounded-2xl border shadow-lg ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
            style={{ width: 188 }}
          >
            <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>Laser colour</div>
            <div className="grid grid-cols-6 gap-1">
              {PEN_COLORS.filter((c) => c !== "#ffffff").map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => setColor(hex)}
                  className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                  style={{
                    background: hex,
                    outline: cur.toLowerCase() === hex.toLowerCase() ? "2px solid #f97316" : "none",
                    outlineOffset: 1,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
                  }}
                />
              ))}
            </div>
            <label className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(cur) ? cur : "#ef4444"}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 24, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
              />
              Custom colour
            </label>
          </div>
        </>
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
function PaintToolbar({ dark, style, setStyle }) {
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
      position="bottom-center"
      // Bottom-centre, clear of the nav; the emote bar lifts above it while
      // painting (see EmoteOverlay barOffset) so the two never collide.
      style={{ bottom: 12 }}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-2xl border shadow-lg max-w-[94vw] overflow-x-auto ${
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

let _idSeq = 1;
function freshId(prefix) {
  // 36ms time + counter is plenty to avoid id collisions inside one
  // tab without dragging in a uuid dep just for this.
  return `${prefix}-${Date.now().toString(36)}-${_idSeq++}`;
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
export function WhiteboardBoard({ boardId, embedded = false }) {
  return (
    <ReactFlowProvider>
      <WhiteboardEditor boardId={boardId} embedded={embedded} />
    </ReactFlowProvider>
  );
}

function WhiteboardEditor({ boardId, embedded = false }) {
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

  const lastSavedRef = useRef("");
  const saveTimerRef = useRef(null);
  const seededRef = useRef(false);
  const [saveState, setSaveState] = useState("idle"); // idle | dirty | saving | saved

  const rf = useReactFlow();
  const connectingRef = useRef(null);
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
  const onWbPointerMove = useCallback(
    (e) => {
      try {
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        lastPtRef.current = { x: p.x, y: p.y };
        pushCursor(p.x, p.y, toolRef.current === "laser", laserDrawingRef.current, laserColorRef.current);
        // Laser ink: append while the button is held (the trail fades itself).
        if (laserDrawingRef.current) {
          const arr = laserInkRef.current;
          const last = arr[arr.length - 1];
          if (!last || Math.abs(p.x - last.x) + Math.abs(p.y - last.y) > 1) {
            arr.push({ x: p.x, y: p.y, t: Date.now() });
          }
        }
        // Raster brush: rasterise locally each move; batch the broadcast.
        if (paintStrokeIdRef.current) {
          paintRef.current?.apply({ id: paintStrokeIdRef.current, brush: paintBrushRef.current, pts: [[p.x, p.y]] }, true);
          paintBatchRef.current.push([p.x, p.y]);
          const now = Date.now();
          if (now - paintLastFlushRef.current > 70) { paintLastFlushRef.current = now; flushPaint(); }
        }
        const dr = drawingRef.current;
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
      let p;
      try { p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch { return; }
      if (mode === "pen") {
        drawingRef.current = { points: [[p.x, p.y]] };
        setDrawPath(strokePath(drawingRef.current.points));
      } else if (mode === "laser") {
        laserDrawingRef.current = true;
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
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* */ }
      e.preventDefault();
    },
    [rf, pushCursor]
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
      if (laserDrawingRef.current) {
        laserDrawingRef.current = false;
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* */ }
        // Tell peers ink stopped (the trail then fades out on its own).
        const lp = lastPtRef.current;
        if (lp) pushCursor(lp.x, lp.y, true, false, laserColorRef.current);
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
    if (p) pushCursor(p.x, p.y, tool === "laser", false, laserColorRef.current);
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
    connectingRef.current = { ...params, sx: e?.clientX, sy: e?.clientY };
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
        shape: (isShapeParent && srcNode?.data?.shape) || "process",
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
      const M = 12;
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
    [rf, setNodes, setEdges]
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
    (type, extra = {}) => {
      const size = DEFAULTS[type] || { w: 180, h: 100 };
      // Drop the new node near the visible center so the user sees it
      // appear without having to pan.
      let centerWorld = { x: 200, y: 200 };
      try {
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
    const all = rf.getNodes();
    const set = new Set(ids);
    for (const n of all) if (n.parentId && set.has(n.parentId)) set.add(n.id); // frame children ride along
    const src = all.filter((n) => set.has(n.id) && n.type !== "zone");
    if (!src.length) return;
    const idMap = new Map(src.map((n) => [n.id, freshId(n.type || "dup")]));
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
    setEdges((eds) => {
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
    });
  }, [rf, setNodes, setEdges]);
  // Ref so the keydown handler (subscribed once) can call the latest clone fn.
  const cloneRef = useRef(null);
  cloneRef.current = cloneNodes;

  // Alt/Option-drag = clone: at drag start, drop a copy of the dragged node(s)
  // in place (unselected) and let the ORIGINALS keep dragging — so you pull a
  // duplicate out, leaving the copy behind. Guarded so we clone once per drag.
  const altCloningRef = useRef(false);
  const onNodeDragStartClone = useCallback((event, node) => {
    const alt = event?.altKey ?? event?.sourceEvent?.altKey;
    if (!alt || altCloningRef.current) return;
    altCloningRef.current = true;
    const all = rf.getNodes();
    const ids = node.selected
      ? all.filter((n) => n.selected && n.type !== "zone").map((n) => n.id)
      : [node.id];
    const set = new Set(ids);
    for (const n of all) if (n.parentId && set.has(n.parentId)) set.add(n.id); // frame children ride along
    const src = all.filter((n) => set.has(n.id) && n.type !== "zone");
    if (!src.length) return;
    const idMap = new Map(src.map((n) => [n.id, freshId(n.type || "dup")]));
    const clones = src.map((n) => {
      const next = { ...n, id: idMap.get(n.id), data: { ...n.data }, selected: false, dragging: false };
      if (n.parentId && idMap.has(n.parentId)) next.parentId = idMap.get(n.parentId);
      next.position = { ...n.position }; // SAME spot — the copy stays put
      return next;
    });
    setNodes((nds) => nds.concat(clones));
    setEdges((eds) => {
      const inside = eds.filter((e) => idMap.has(e.source) && idMap.has(e.target));
      if (!inside.length) return eds;
      return eds.concat(inside.map((e) => ({
        ...e, id: freshId("e"), selected: false,
        source: idMap.get(e.source), target: idMap.get(e.target),
        data: e.data ? { ...e.data } : e.data,
      })));
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
    }
  }, [cloneNodes]);

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

  // Export the whole board as a PNG. We capture React Flow's viewport element
  // with an overridden transform that frames the nodes' bounding box (so the
  // export covers everything, not just what's on screen). html-to-image clones
  // the node, so the live view isn't disturbed.
  const handleExportPng = useCallback(async () => {
    const el = mainRef.current?.querySelector(".react-flow__viewport");
    if (!el) return;
    const bounds = getNodesBounds(rf.getNodes());
    if (!bounds.width || !bounds.height) { setError("Nothing to export yet."); return; }
    const pad = 48;
    // Up to 2x for crisp small boards; scale down big ones to cap ~4000px.
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
  }, [rf, dark, board?.title]);

  const template = useMemo(
    () => (board?.template_key ? TEMPLATES[board.template_key] : null),
    [board?.template_key]
  );

  // ── early returns ──
  const frameCls = embedded
    ? "w-full h-full p-4 space-y-3"
    : "px-4 pt-6 pb-6 max-w-[1400px] mx-auto space-y-3";
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
      // Subtract the nav bar (3.5rem mobile / 4rem desktop) AND both safe-area
      // insets. Without the top env() the canvas is ~59px too tall on Dynamic
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
          : "h-[calc(100dvh-3.5rem-var(--top-inset)-var(--bottom-inset))] sm:h-[calc(100dvh-4rem-var(--top-inset)-var(--bottom-inset))]"
      }`}
      onPointerMove={onWbPointerMove}
      onPointerDownCapture={onWbPointerDownCapture}
      onPointerUp={onWbPointerUp}
      onPointerCancel={onWbPointerUp}
    >
      <EdgeMarkerDefs />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeSnap}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
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
        selectionOnDrag={tool === "select"}
        selectionMode={SelectionMode.Partial}
        // Shift adds to selection, freeing ⌘/Ctrl for the click-to-clone quick action.
        multiSelectionKeyCode="Shift"
        // Zoom way out for big boards (default floor is 0.5); a bit more in too.
        minZoom={0.1}
        maxZoom={3}
        // Left-drag is reserved (marquee in select, draw in pen/laser-ink), so
        // panning is always middle/right-drag — plus the activation key below.
        panOnDrag={[1, 2]}
        // Trackpad: two-finger scroll pans, pinch zooms (ctrl/⌘+scroll too);
        // hold Space to drag-pan. Left-drag still marquee-selects.
        panOnScroll
        zoomOnScroll={false}
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
        <Controls position="bottom-left" />
        {!compact && showMinimap && <MiniMap pannable zoomable position="bottom-right" />}
        <CollabCursors peers={peers} />
        <PresenceStack members={members} dark={dark} />

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
        {tool === "brush" && <PaintToolbar dark={dark} style={brushStyle} setStyle={setBrushStyle} />}

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

        <Panel
          position="center-left"
          className={`flex flex-col items-center gap-0.5 p-1 rounded-2xl border shadow-sm ${
            dark
              ? "bg-[var(--color-surface)] border-[var(--color-border)]"
              : "bg-white border-slate-200"
          }`}
        >
          <StickyTool
            dark={dark}
            onAdd={(hex) =>
              addNodeAtCenter("sticky", hex ? { color: hex } : {})
            }
          />
          <TextTool
            dark={dark}
            prefs={textStyle}
            setPrefs={setTextStyle}
            onAdd={() => addNodeAtCenter("text", textStyleRef.current)}
          />
          <div
            className={`h-px w-5 my-0.5 ${
              dark ? "bg-[var(--color-border)]" : "bg-slate-200"
            }`}
          />
          <ShapesMenu
            dark={dark}
            onPick={(shape) => addNodeAtCenter("shape", { shape })}
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
          <div
            className={`h-px w-5 my-0.5 ${
              dark ? "bg-[var(--color-border)]" : "bg-slate-200"
            }`}
          />
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
          <div
            className={`h-px w-5 my-0.5 ${
              dark ? "bg-[var(--color-border)]" : "bg-slate-200"
            }`}
          />
          <ToolButton
            title="Delete selected"
            tone="red"
            dark={dark}
            onClick={deleteSelected}
          >
            <Trash2 className="w-4 h-4" />
          </ToolButton>
        </Panel>

        {/* Node inspector (shape/fill/border/text) hovers above the
              selected node, like the edge toolbar. Edges use their own
              floating contextual toolbar (rendered on the edge itself). */}
        {selectedNode && singleSelection && (
          <NodeToolbar
            nodeId={selectedNode.id}
            isVisible
            position={Position.Top}
            // Frames carry a floating label above their top edge — push the
            // toolbar above THAT (like the edge toolbar clears the line) so it
            // never overlaps the title.
            offset={selectedNode.type === "frame" ? (selectedNode.data?.fontSize ?? 20) + 28 : 14}
            align="center"
          >
            <Inspector node={selectedNode} patchNodeData={patchNodeData} setLocked={setSelectedLocked} onReorder={reorderSelected} setOpacity={setSelectedOpacity} />
          </NodeToolbar>
        )}
      </ReactFlow>

      {/* My own laser glow (screen space) — only while laser mode is on. */}
      <LocalLaser active={tool === "laser"} color={effectiveLaserColor} />
      {/* Photoshop-style brush ring while painting (replaces the crosshair). */}
      <BrushCursor active={tool === "brush"} size={brushStyle.size} color={brushStyle.color} erase={brushStyle.erase} />

      {/* Breadcrumb / board chrome — a floating card pinned top-left,
            like the timer. Holds back-nav, title, template badge, save
            state, the reactions-bar toggle, and archive. */}
      <div className="absolute left-3 top-3 z-40 flex flex-col gap-2 items-start max-w-[calc(100%-24px)]">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-2xl border shadow-md"
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
                className={`w-px h-4 ${
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
            className={`w-px h-4 ${
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
          {!compact && (
            <>
              <div
                className={`w-px h-4 ${
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
            </>
          )}
          {!embedded && (
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
          {!embedded && (
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
          className="absolute left-1/2 -translate-x-1/2 top-3 z-30 flex items-stretch max-w-[calc(100%-32px)]"
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
        barPosition={emoteBarOn && !compact ? "bottom-center" : "hidden"}
        // Lift the emote bar above the paint toolbar while it's showing.
        barOffset={tool === "brush" ? 80 : 0}
      />
    </main>
  );
}
