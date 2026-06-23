import { lazy, Suspense, memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeResizer, useReactFlow } from "@xyflow/react";
import { nodeAbsPos, sortParentsFirst } from "./frame";
import { Target, ChevronDown, Building2, User, Star, X, Plus } from "lucide-react";
import { useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";
import { setGoal, clearGoal } from "../../lib/goals";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Markdown rendering for node display text. gfm = bold/italic, lists, links,
// tables, task checkboxes; breaks = a single newline stays a line break (so
// existing multi-line notes don't suddenly collapse into one paragraph).
const MD_PLUGINS = [remarkGfm, remarkBreaks];
const MD_COMPONENTS = {
  // Links open in a new tab and must NOT start a node drag or bubble into the
  // "click to edit" handler on the node body.
  a: ({ node, ...props }) => (
    <a
      {...props}
      className="nodrag"
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    />
  ),
};

// Full emoji picker for sticky reactions — lazy so its chunk only loads
// when someone opens it.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

// Preferred sticky colour (per device) — new stickies (toolbar + frame
// double-click) use it; changing a sticky's colour updates it.
const STICKY_COLOR_KEY = "ql_wb_sticky_color";
export function preferredStickyColor() {
  try { return localStorage.getItem(STICKY_COLOR_KEY) || "yellow"; } catch { return "yellow"; }
}
export function setPreferredStickyColor(c) {
  try { localStorage.setItem(STICKY_COLOR_KEY, c); } catch { /* */ }
}

let _sid = 1;
function freshStickyId() { return `sticky-${Date.now().toString(36)}-${_sid++}`; }

// Current user's short display name, for stamping authorship.
function useMyName() {
  const { session, settings } = useApp() || {};
  return settings?.name || session?.user?.user_metadata?.name || session?.user?.email?.split("@")[0] || "";
}

const QUICK_REACTIONS = ["👍", "❤️", "🎉", "🔥"];

// Selection accent — follows the user's theme accent (var(--color-accent)) so
// the whole selection treatment (ring, resize handles, shape outline) matches
// the active theme instead of a fixed orange.
const SELECT = "var(--color-accent)";
const SELECT_FILL = "color-mix(in srgb, var(--color-accent) 6%, transparent)";
// Selection = a THICKER version of the item's own outline; items without an
// outline (sticky, text) fall back to the theme accent. Resize handles + guide
// lines take that same colour.
const resizer = (color) => ({ lineStyle: { borderColor: color }, handleStyle: { background: color, border: "2px solid #fff" } });

// Readable text colour (near-black / near-white) for a solid background, so
// labels stay legible on any fill — a white default, a dark-theme surface, or a
// user-picked swatch. Non-hex inputs fall back to dark text.
function readableText(bg) {
  if (typeof bg !== "string" || bg[0] !== "#") return "#0f172a";
  let h = bg.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return "#0f172a";
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#f1f5f9";
}

// Vertical text placement (data.vAlign) → flexbox alignment for the text box.
function vAlignFlex(v) {
  return v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center";
}

// Nodes that should open straight into edit mode (just created via the
// toolbar or a quick-add pull). Tracked outside node data so the flag
// never persists to the snapshot or syncs to peers.
const PENDING_EDIT = new Set();
export function markNodeForEdit(id) { if (id) PENDING_EDIT.add(id); }

// The textarea currently being edited registers a "wrap the selection in
// markdown" handler here, so a toolbar button (Inspector B / I) can format the
// LIVE selection without stealing focus. Returns false when nothing is being
// edited (the caller can then fall back to toggling the whole node's text).
const activeEditor = { current: null };
export function wrapActiveSelection(marker) {
  if (!activeEditor.current) return false;
  activeEditor.current(marker);
  return true;
}

// Shared text editor used inside the sticky / text / shape nodes.
// Stops propagating wheel + pointerdown so the canvas doesn't pan under
// the cursor mid-edit. Opens immediately for freshly-created nodes
// (markNodeForEdit) and on a single click once the node is selected.
function EditableText({ value, onChange, placeholder, className, style, nodeId, selected, markdown }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const textareaRef = useRef(null);

  // Fresh nodes (markNodeForEdit) open straight into edit. Consume the
  // flag in an effect — NOT the state initializer — so the delete side
  // effect is StrictMode-safe (state survives its simulated remount).
  useEffect(() => {
    if (nodeId && PENDING_EDIT.has(nodeId)) { PENDING_EDIT.delete(nodeId); setEditing(true); }
  }, [nodeId]);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.select();
    }
  }, [editing]);

  // Register a selection-wrapper while editing so the Inspector B / I buttons
  // can markdown-format the live selection (their mouse-down keeps our focus).
  useEffect(() => {
    if (!editing) return undefined;
    const fn = (marker) => {
      const el = textareaRef.current;
      if (!el) return;
      const s = el.selectionStart ?? 0, e = el.selectionEnd ?? 0;
      const val = el.value, sel = val.slice(s, e), ml = marker.length;
      let next, selStart, selEnd;
      if (sel.length >= 2 * ml && sel.startsWith(marker) && sel.endsWith(marker)) {
        const inner = sel.slice(ml, sel.length - ml); // already wrapped → toggle off
        next = val.slice(0, s) + inner + val.slice(e);
        selStart = s; selEnd = s + inner.length;
      } else {
        next = val.slice(0, s) + marker + sel + marker + val.slice(e);
        selStart = s + ml; selEnd = e + ml;
      }
      setDraft(next.slice(0, 1000));
      requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        try { t.setSelectionRange(selStart, selEnd); } catch { /* */ }
      });
    };
    activeEditor.current = fn;
    return () => { if (activeEditor.current === fn) activeEditor.current = null; };
  }, [editing]);

  const commit = useCallback(() => {
    if (draft !== value) onChange?.(draft);
    setEditing(false);
  }, [draft, value, onChange]);

  if (!editing) {
    return (
      <div
        className={`${markdown ? "wb-md" : "whitespace-pre-wrap break-words"} ${className || ""}`}
        style={style}
        onClick={() => { if (selected) setEditing(true); }}
        onDoubleClick={() => setEditing(true)}
      >
        {!value ? (
          <span style={{ opacity: 0.45, fontStyle: "italic" }}>
            {placeholder || "Double-click to edit…"}
          </span>
        ) : markdown ? (
          <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
            {value}
          </ReactMarkdown>
        ) : (
          value
        )}
      </div>
    );
  }

  // A textarea has a cols-based intrinsic WIDTH, which blows up an auto-width
  // node (text) the moment you start editing. So we overlay the textarea on an
  // invisible SIZER with identical typography + wrapping: the grid cell sizes
  // to the sizer (= the text), and the textarea fills it. Editing now hugs the
  // content exactly like display does — in both width and height — for free.
  return (
    <div style={{ display: "grid" }}>
      <div
        aria-hidden
        className={className}
        style={{
          ...style,
          gridArea: "1 / 1",
          visibility: "hidden",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          margin: 0,
          padding: 0,
          minWidth: "1ch",
          pointerEvents: "none",
        }}
      >
        {(draft || placeholder || " ") + "​"}
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        cols={1}
        onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { commit(); }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        // `nodrag`/`nowheel` are the canonical React Flow opt-outs: with them the
        // canvas won't start a node drag (or pan/zoom) on a pointer-down inside
        // the textarea, so click-drag SELECTS text instead of moving the node.
        // (stopPropagation alone can't stop d3-drag's capture-phase listener.)
        className={`nodrag nowheel resize-none border-none outline-none bg-transparent overflow-hidden ${className || ""}`}
        style={{ ...style, gridArea: "1 / 1", width: "100%", height: "100%", margin: 0, padding: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      />
    </div>
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
function FourHandles() {
  // Visibility + pointer-events are driven by CSS (.wb-conn-handle) so the
  // dots only appear/intercept on node hover or selection — the body stays
  // grabbable for moving. zIndex keeps them above the resizer edge lines.
  const base = {
    width: 12, height: 12, background: "#0ea5e9",
    border: "2px solid #fff", borderRadius: 9999,
    zIndex: 12,
  };
  return (
    <>
      <Handle type="source" position={Position.Top}    id="t" className="wb-conn-handle" style={base} />
      <Handle type="source" position={Position.Right}  id="r" className="wb-conn-handle" style={base} />
      <Handle type="source" position={Position.Bottom} id="b" className="wb-conn-handle" style={base} />
      <Handle type="source" position={Position.Left}   id="l" className="wb-conn-handle" style={base} />
    </>
  );
}

// ─── StickyNote ───────────────────────────────────────────────────

// Legacy named sticky colors (still on old notes). New notes store a hex
// directly; stickyHex() resolves either form to a hex.
export const STICKY_BG = {
  yellow: "#fde68a", pink: "#fbcfe8", blue: "#bfdbfe", green: "#bbf7d0",
  purple: "#ddd6fe", orange: "#fed7aa", coral: "#fecaca", slate: "#e2e8f0",
};
export function stickyHex(c) {
  return STICKY_BG[c] || c || STICKY_BG.yellow;
}
// Curated "white range" of sticky pastels for the toolbar + inspector.
export const STICKY_PALETTE = [
  "#c4b5fd", "#ddd6fe", "#e9d5ff", "#f5d0fe", "#fbcfe8", "#fce7f3",
  "#fecaca", "#fed7aa", "#fde68a", "#fef08a", "#d9f99d", "#bbf7d0",
  "#a7f3d0", "#99f6e4", "#a5f3fc", "#bae6fd", "#bfdbfe", "#c7d2fe",
  "#e2e8f0", "#cbd5e1", "#f1f5f9", "#e7e5e4", "#d6d3d1", "#fafaf9",
];

export const StickyNode = memo(function StickyNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const patch = useNodeDataPatcher(id);
  const { setNodes } = useReactFlow();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false); // "view all reactions" popover
  // Legacy notes were created without an explicit size; give them one (square,
  // from their measured box) so the resizer has real dimensions to work from.
  useEffect(() => {
    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        if (n.id === id && (n.width == null || n.height == null)) {
          changed = true;
          const s = n.measured?.width || 144;
          return { ...n, width: s, height: s };
        }
        return n;
      });
      return changed ? next : nds;
    });
  }, [id, setNodes]);
  const bg = stickyHex(data?.color);
  // Ink contrasts with the note colour (dark on a pastel, light on a deep hue);
  // the author line is the same ink, dimmed.
  const ink = readableText(bg);
  const authorInk = ink === "#0f172a" ? "rgba(40,28,8,.55)" : "rgba(255,255,255,.72)";
  const reactions = data?.reactions || {};
  const react = (emoji) => patch({ reactions: { ...reactions, [emoji]: (reactions[emoji] || 0) + 1 } });
  // Click a chip to take one back (drops off at zero).
  const unreact = (emoji) => {
    const next = { ...reactions, [emoji]: (reactions[emoji] || 0) - 1 };
    if (next[emoji] <= 0) delete next[emoji];
    patch({ reactions: next });
  };
  const shown = Object.entries(reactions).filter(([, c]) => c > 0);
  const author = data?.author || "";
  const stop = (e) => e.stopPropagation();
  // Small dark reaction pill; at most a few show on the note, the rest live in
  // a "⋯" popover so the strip never runs off the edge.
  const chipStyle = { display: "inline-flex", alignItems: "center", gap: 2, background: "#171430", color: "#fff", fontSize: 8, fontWeight: 700, lineHeight: 1, borderRadius: 5, padding: "2px 5px", border: `1.5px solid ${SELECT}`, boxShadow: "0 3px 8px -3px rgba(0,0,0,.5)", cursor: "pointer" };
  const MAX_CHIPS = 3;
  const remove = () => setNodes((nds) => nds.filter((n) => n.id !== id));
  return (
    <div
      className="wb-sticky"
      style={{
        // Fills the node box so it resizes (size normalised on mount below);
        // small floor only guards the first frame before that runs.
        width: "100%", height: "100%", minWidth: 96, minHeight: 96, position: "relative",
        background: bg, color: ink,
        borderRadius: 3,
        boxShadow: selected
          ? `0 0 0 2px ${SELECT}, 0 16px 28px -12px rgba(0,0,0,.45), 0 3px 7px -2px rgba(0,0,0,.22)`
          : "0 14px 26px -12px rgba(0,0,0,.4), 0 3px 7px -3px rgba(0,0,0,.18)",
        display: "flex", flexDirection: "column",
        padding: "16px 16px 12px",
        fontFamily: "inherit",
      }}
    >
      {/* Resizable but square (keepAspectRatio); no connection handles. */}
      <NodeResizer isVisible={selected && !data?.locked} minWidth={120} minHeight={120} keepAspectRatio {...resizer(SELECT)} />
      {selected && (
        <button type="button" className="nodrag" onPointerDown={stop} onClick={remove} title="Delete"
          style={{ position: "absolute", top: 6, right: 6, opacity: 0.4, display: "flex", color: ink }}>
          <X style={{ width: 13, height: 13 }} />
        </button>
      )}

      {/* Note text — vertical placement, alignment + colour are per-note. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: vAlignFlex(data?.vAlign), justifyContent: "center", overflow: "hidden" }}>
        <EditableText
          value={data?.text}
          onChange={setText}
          placeholder="Type a note…"
          nodeId={id}
          selected={selected}
          markdown
          style={{ fontSize: data?.fontSize ?? 16, fontWeight: 600, lineHeight: 1.25, width: "100%", textAlign: data?.textAlign || "center", color: data?.textColor || ink }}
        />
      </div>

      {/* Author, bottom-right. */}
      {author && (
        <div style={{ alignSelf: "flex-end", fontSize: 11, fontWeight: 500, color: authorInk, maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {author}
        </div>
      )}

      {/* Reactions overhang the bottom edge. The "viewer" (chips) wraps within
          the note's width so it never flies off; the quick-react bar and the
          full emoji picker stack BELOW it when the note is selected. Click a
          chip to take a reaction back. */}
      <div className="nodrag" onPointerDown={stop}
        style={{ position: "absolute", left: 10, top: "calc(100% - 14px)", zIndex: 5, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        {shown.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {shown.slice(0, MAX_CHIPS).map(([e, c]) => (
              <button key={e} type="button" onClick={() => unreact(e)} title="Click to remove a reaction" style={chipStyle}>
                <span style={{ fontSize: 10 }}>{e}</span>
                <span>+{c}</span>
              </button>
            ))}
            {shown.length > MAX_CHIPS && (
              <button type="button" onClick={() => setAllOpen((v) => !v)} title="View all reactions"
                style={{ ...chipStyle, fontWeight: 800, padding: "2px 6px" }}>⋯</button>
            )}
          </div>
        )}
        {allOpen && (
          <>
            <div className="nodrag" onPointerDown={(e) => { stop(e); setAllOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
            <div className="nodrag nowheel" onPointerDown={stop}
              style={{ zIndex: 60, maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, minWidth: 92, background: "#171430", border: `1.5px solid ${SELECT}`, borderRadius: 9, padding: 5, boxShadow: "0 12px 26px -8px rgba(0,0,0,.6)" }}>
              {shown.map(([e, c]) => (
                <button key={e} type="button" onClick={() => unreact(e)} title="Click to remove a reaction"
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 5px", borderRadius: 5, cursor: "pointer" }}>
                  <span style={{ fontSize: 15 }}>{e}</span>
                  <span>+{c}</span>
                  <X style={{ width: 11, height: 11, marginLeft: "auto", opacity: 0.55 }} />
                </button>
              ))}
            </div>
          </>
        )}
        {selected && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 1, background: "#171430", borderRadius: 9, padding: "2px 5px", border: "2px solid rgba(255,255,255,.16)", boxShadow: "0 5px 12px -4px rgba(0,0,0,.5)" }}>
            {QUICK_REACTIONS.map((e) => (
              <button key={e} type="button" onClick={() => react(e)} title={`React ${e}`} style={{ fontSize: 14, lineHeight: 1, padding: "1px 2px" }}>{e}</button>
            ))}
            <button type="button" onClick={() => setEmojiOpen((v) => !v)} title="More emojis" aria-label="More emojis"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 9999, color: "#fff" }}>
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}
        {emojiOpen && (
          <>
            <div className="nodrag" onPointerDown={(e) => { stop(e); setEmojiOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
            <div className="nodrag nowheel" onPointerDown={stop} style={{ zIndex: 60, borderRadius: 12, overflow: "hidden", boxShadow: "0 16px 36px -16px rgba(0,0,0,.5)" }}>
              <Suspense fallback={null}>
                <EmojiPicker onEmojiClick={(d) => { react(d.emoji); setEmojiOpen(false); }} theme="light" width={232} height={300} lazyLoadEmojis skinTonesDisabled previewConfig={{ showPreview: false }} />
              </Suspense>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ─── TextNode ──────────────────────────────────────────────────────

// Padding presets for a text node's background chip (data.pad).
const TEXT_PAD = { none: "0px", sm: "8px 14px", md: "16px 26px", lg: "30px 44px" };

export const TextNode = memo(function TextNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  // Optional background turns a text node into a label / chip / callout. When a
  // fill is set the default text colour auto-contrasts against it (like sticky
  // and shape do); radius + padding round the chip.
  const fill = data?.fill || null;
  const radius = data?.radius ?? 8;
  const textColor = data?.textColor || (fill ? readableText(fill) : "var(--color-text)");
  return (
    <div
      style={{
        minWidth: 180,
        padding: fill ? (TEXT_PAD[data?.pad] || TEXT_PAD.md) : "8px 12px",
        background: fill || (selected ? SELECT_FILL : "transparent"),
        borderRadius: radius,
        boxShadow: selected ? `0 0 0 2px ${SELECT}` : (fill ? "0 6px 16px -8px rgba(0,0,0,.35)" : "none"),
        color: textColor,
      }}
    >
      <FourHandles visible={false} />
      <EditableText
        value={data?.text}
        onChange={setText}
        placeholder="Type some text…"
        nodeId={id}
        selected={selected}
        markdown
        style={{ fontSize: data?.fontSize ?? 16, fontWeight: 700, lineHeight: 1.3, textAlign: data?.textAlign || "left", color: textColor }}
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
  // fill/stroke go through `style` (not attributes) so a CSS var like the
  // theme accent — var(--color-accent) — resolves; attributes don't parse var().
  const p = { strokeWidth: sw, strokeLinejoin: "round", style: { fill, stroke } };
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

// Grow a fixed-size node's HEIGHT so its text never clips. Returns a ref to put
// on a CONTENT-sized element (one that wraps at the node's width but is only as
// tall as its text) — measuring that, not the node-filling box, means the node
// growing can't re-trigger the observer, so there's no feedback loop. Grow-only:
// it raises the node to fit the content but never shrinks it, so you can still
// resize freely — you just can't drag it shorter than the text inside.
function useAutoHeight(id, pad = 0) {
  const ref = useRef(null);
  const { setNodes } = useReactFlow();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => {
      const needed = Math.ceil(el.scrollHeight + pad);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const cur = n.height ?? n.measured?.height ?? 0;
          return needed > cur + 0.5 ? { ...n, height: needed } : n;
        }),
      );
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, [id, pad, setNodes]);
  return ref;
}

export const ShapeNode = memo(function ShapeNode({ id, type, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const { theme } = useTheme();
  const [ref, size] = useNodeSize({ w: 180, h: 100 });
  // Grow the shape's height to fit its text (markdown can run tall) so content
  // never clips. Width stays user-controlled; ~22px covers the 10px×2 padding.
  const growRef = useAutoHeight(id, 22);
  const shape = data?.shape || LEGACY_SHAPE[type] || "process";
  // Default fill follows the theme (a dark surface in dark mode instead of a
  // glaring white box); a user-picked fill is respected. Text auto-contrasts.
  const fill = data?.fill || (theme === "dark" ? "#1e293b" : "#ffffff");
  // Outline keeps its own colour; selecting just THICKENS it (no accent swap).
  const stroke = data?.stroke || "#0ea5e9";
  const sw = selected ? 4 : 2;
  const textColor = readableText(fill);
  return (
    <div ref={ref} style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeResizer
        isVisible={selected && !data?.locked}
        minWidth={70} minHeight={50}
        {...resizer(stroke)}
      />
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ position: "absolute", inset: 0, overflow: "visible", display: "block" }}
      >
        <ShapeSvg shape={shape} w={size.w} h={size.h} fill={fill} stroke={stroke} sw={sw} />
      </svg>
      <FourHandles />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: vAlignFlex(data?.vAlign), justifyContent: "center", padding: "10px 14px" }}>
        <div ref={growRef} style={{ width: "100%", minWidth: 0 }}>
          <EditableText
            value={data?.text}
            onChange={setText}
            placeholder=""
            nodeId={id}
            selected={selected}
            markdown
            style={{ fontSize: data?.fontSize ?? 13, fontWeight: 600, textAlign: data?.textAlign || "center", color: data?.textColor || textColor }}
          />
        </div>
      </div>
    </div>
  );
});

// ─── GoalNode (first-class, linkable to a department or person) ────

export const GoalNode = memo(function GoalNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const patch = useNodeDataPatcher(id);
  const { theme } = useTheme();
  const { orgTeams = [], teamMembers = [], activeTeamId } = useTeam() || {};
  const { whiteboardId } = useParams();
  const [pickerOpen, setPickerOpen] = useState(false);
  const linked = data?.linkType && data?.linkId;
  const linkColor = data?.linkColor || "#f59e0b";
  const goalActive = !!data?.goalActive;
  const canSet = linked && (data?.text || "").trim();
  // Theme-aware surfaces so the goal card reads in dark mode (the amber header
  // banner + accent border stay; only the body/card chrome flips).
  const dark = theme === "dark";
  const surface = dark ? "#1e293b" : "#ffffff";
  const text = dark ? "#e2e8f0" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";
  const divider = dark ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.07)";
  const popBorder = dark ? "rgba(255,255,255,.14)" : "#e2e8f0";

  async function toggleSetAsGoal() {
    if (!activeTeamId || !linked) return;
    if (goalActive) {
      await clearGoal({ teamId: activeTeamId, ownerType: data.linkType, ownerId: data.linkId });
      patch({ goalActive: false });
    } else {
      if (!(data?.text || "").trim()) return;
      const { error } = await setGoal({
        teamId: activeTeamId, ownerType: data.linkType, ownerId: data.linkId,
        ownerName: data.linkName, ownerColor: data.linkColor, body: data.text,
        boardId: whiteboardId, nodeId: id,
      });
      if (!error) patch({ goalActive: true });
    }
  }
  return (
    <div
      style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: surface, borderRadius: 14,
        border: `${selected ? 4 : 2}px solid #f59e0b`,
        boxShadow: selected ? "0 12px 28px -14px rgba(0,0,0,.4)" : "0 8px 20px -12px rgba(0,0,0,.3)",
        color: text,
      }}
    >
      <NodeResizer isVisible={selected && !data?.locked} minWidth={200} minHeight={120} {...resizer("#f59e0b")} />
      {/* No connection handles — goals aren't edge endpoints. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "linear-gradient(120deg,#f59e0b,#f97316)", color: "#fff", borderRadius: "12px 12px 0 0" }}>
        <Target style={{ width: 14, height: 14 }} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em" }}>GOAL</span>
        <button
          type="button"
          className="nodrag"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSetAsGoal}
          disabled={!goalActive && !canSet}
          title={goalActive ? "Currently set as the goal — click to unset" : canSet ? "Set as the current goal for its tag" : "Add text + link it first"}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, color: "#fff", opacity: goalActive || canSet ? 1 : 0.55, padding: "1px 6px", borderRadius: 9999, background: goalActive ? "rgba(255,255,255,.25)" : "transparent" }}
        >
          <Star style={{ width: 12, height: 12 }} fill={goalActive ? "#fff" : "none"} />
          {goalActive ? "SET" : "Set goal"}
        </button>
      </div>
      <div style={{ flex: 1, padding: 10, minHeight: 0 }}>
        <EditableText value={data?.text} onChange={setText} placeholder="Write the goal…" nodeId={id} selected={selected} style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }} />
      </div>
      <div className="nodrag" style={{ position: "relative", padding: "6px 10px", borderTop: `1px solid ${divider}` }} onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: linked ? "#fff" : muted, background: linked ? linkColor : "transparent", padding: linked ? "2px 8px" : 0, borderRadius: 9999 }}
        >
          {data?.linkType === "user" ? <User style={{ width: 12, height: 12 }} /> : <Building2 style={{ width: 12, height: 12 }} />}
          {linked ? data.linkName : "Link to a team or person"}
          <ChevronDown style={{ width: 11, height: 11, opacity: 0.6 }} />
        </button>
        {pickerOpen && (
          <div className="nowheel" style={{ position: "absolute", bottom: 34, left: 8, zIndex: 40, width: 196, maxHeight: 220, overflowY: "auto", background: surface, border: `1px solid ${popBorder}`, borderRadius: 12, boxShadow: "0 16px 36px -16px rgba(0,0,0,.45)", padding: 4 }}>
            {orgTeams.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, color: muted, textTransform: "uppercase", letterSpacing: ".08em", padding: "4px 8px 2px" }}>Departments</div>}
            {orgTeams.map((t) => (
              <button key={t.id} type="button" onClick={() => { patch({ linkType: "department", linkId: t.id, linkName: t.name, linkColor: t.color || "#f59e0b" }); setPickerOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "4px 8px", borderRadius: 8, fontSize: 12, color: text }}>
                <span style={{ width: 8, height: 8, borderRadius: 9999, background: t.color || "#94a3b8", flexShrink: 0 }} />
                {t.name}
              </button>
            ))}
            {teamMembers.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, color: muted, textTransform: "uppercase", letterSpacing: ".08em", padding: "6px 8px 2px" }}>People</div>}
            {teamMembers.map((m) => (
              <button key={m.user_id} type="button" onClick={() => { patch({ linkType: "user", linkId: m.user_id, linkName: m.name || "Member", linkColor: "#64748b" }); setPickerOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "4px 8px", borderRadius: 8, fontSize: 12, color: text }}>
                <User style={{ width: 12, height: 12, color: muted }} />
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

// ─── FrameNode (resizable, labelled container / section) ──────────
//
// A first-class container you drop sticky notes / cards into to group
// them — the building block for retro columns, kanban lanes, etc. Sits
// behind content (created with a low zIndex) so nodes layer on top; the
// header is editable.

export const FrameNode = memo(function FrameNode({ id, data, selected }) {
  const setText = useNodeTextUpdater(id);
  const { setNodes, screenToFlowPosition } = useReactFlow();
  const myName = useMyName();
  // The frame's colour comes from the inspector's Fill control (data.fill);
  // `tint` drives the border + floating label, and the faint interior is
  // derived from it (legacy data.tint/data.bg still honoured).
  const tint = data?.fill || data?.tint || "#0ea5e9";
  const bg = data?.bg || `color-mix(in srgb, ${tint} 8%, transparent)`;
  // Floating label chrome: background is transparent by default, can follow the
  // frame tint, or be a custom colour (data.labelBg = "none" | "tint" | hex).
  // Title size follows the inspector's text-size control; it defaults to the
  // normal (Medium) size and can be bumped to X-Large for a big heading.
  const labelFill = data?.labelBg === "tint" ? tint : (data?.labelBg && data.labelBg !== "none" ? data.labelBg : null);
  const labelInk = labelFill ? readableText(labelFill) : tint;
  const titleSize = data?.fontSize ?? 20;
  const addSticky = (e) => {
    e.stopPropagation();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => {
      const byId = new Map(nds.map((n) => [n.id, n]));
      const fAbs = byId.get(id) ? nodeAbsPos(byId.get(id), byId) : { x: 0, y: 0 };
      const sticky = {
        id: freshStickyId(),
        type: "sticky",
        parentId: id,
        // No extent:"parent" — the note belongs to the frame but stays
        // free to drag out (soft container).
        position: { x: p.x - fAbs.x - 72, y: p.y - fAbs.y - 72 },
        width: 144, height: 144, // explicit size → resizable
        data: { text: "", color: preferredStickyColor(), author: myName },
        selected: true,
      };
      const deselected = nds.map((n) => (n.selected ? { ...n, selected: false } : n));
      return sortParentsFirst([...deselected, sticky]);
    });
  };
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeResizer isVisible={selected && !data?.locked} minWidth={160} minHeight={140} {...resizer(tint)} />
      {/* Label floats just ABOVE the frame's top-left (Lucidchart/Lucidspark
          style) — outside the clipped box so it's never cut off. */}
      <div style={{ position: "absolute", left: 2, bottom: "calc(100% + 5px)", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 360, ...(labelFill ? { background: labelFill, padding: "2px 10px", borderRadius: 8 } : null) }}>
        {data?.icon && <span style={{ fontSize: titleSize, lineHeight: 1 }}>{data.icon}</span>}
        <EditableText value={data?.text ?? data?.label} onChange={setText} placeholder="Section title" nodeId={id} selected={selected} style={{ fontSize: titleSize, fontWeight: 800, color: labelInk, lineHeight: 1.15, overflowWrap: "anywhere" }} />
      </div>
      {/* The frame box — bordered, faint fill, clips its contents. No connection
          handles (frames aren't edge endpoints). Double-click to add a sticky. */}
      <div style={{ width: "100%", height: "100%", borderRadius: 18, border: `${selected ? 4 : 2}px solid ${tint}`, background: bg, overflow: "hidden" }}
        onDoubleClick={addSticky} title="Double-click to add a sticky note" />
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

// ─── ImageNode ─────────────────────────────────────────────────────
// An embedded image. The bytes live in Supabase Storage (whiteboard-images
// bucket); the node only carries the public URL (data.src) + path, so the
// snapshot and realtime ops stay tiny. Resizes with a locked aspect ratio and
// connects like any other node (FourHandles + free anchors).
export const ImageNode = memo(function ImageNode({ id, data, selected }) {
  const { setNodes } = useReactFlow();
  const src = data?.src;
  const stop = (e) => e.stopPropagation();
  const remove = () => setNodes((nds) => nds.filter((n) => n.id !== id));
  return (
    <div
      style={{
        width: "100%", height: "100%", position: "relative",
        borderRadius: 6, overflow: "hidden", background: "#0b1020",
        boxShadow: selected
          ? `0 0 0 2px ${SELECT}, 0 16px 28px -12px rgba(0,0,0,.5)`
          : "0 14px 26px -12px rgba(0,0,0,.4), 0 3px 7px -3px rgba(0,0,0,.18)",
      }}
    >
      <NodeResizer isVisible={selected && !data?.locked} minWidth={48} minHeight={48} keepAspectRatio {...resizer(SELECT)} />
      {src ? (
        <img
          src={src}
          alt={data?.alt || ""}
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", pointerEvents: "none", userSelect: "none" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12, padding: 8, textAlign: "center" }}>
          Image unavailable
        </div>
      )}
      <FourHandles />
      {selected && (
        <button
          type="button" className="nodrag" onPointerDown={stop} onClick={remove} title="Delete"
          style={{ position: "absolute", top: 6, right: 6, display: "flex", color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: 6, padding: 3 }}
        >
          <X style={{ width: 13, height: 13 }} />
        </button>
      )}
    </div>
  );
});

export const NODE_TYPES = {
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  goal: GoalNode,
  frame: FrameNode,
  image: ImageNode,
  // Legacy aliases — old snapshots store these node types.
  rect: ShapeNode,
  ellipse: ShapeNode,
  diamond: ShapeNode,
  zone: ZoneNode,
};
