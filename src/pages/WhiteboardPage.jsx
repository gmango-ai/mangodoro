import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Panel, MiniMap,
  useNodesState, useEdgesState, addEdge, reconnectEdge, useReactFlow, MarkerType, ConnectionMode, SelectionMode,
  NodeToolbar, Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Target, Pencil, Archive, Type, Shapes, Frame, Trash2, ChevronDown, Smile,
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
import { NODE_TYPES, SHAPES, ShapeSvg, preferredStickyColor, setPreferredStickyColor, STICKY_PALETTE, stickyHex, markNodeForEdit } from "../components/whiteboard/nodes";
import { nodeAbsPos, sortParentsFirst, frameAt } from "../components/whiteboard/frame";
import { useApp } from "../context/AppContext";
import { EDGE_TYPES, EdgeMarkerDefs, ConnectionLine, connectedNodePlacement, siblingPlacement, nodeRect, projectToPerimeter, ANCHOR_TO_HANDLE } from "../components/whiteboard/edges";
import { useWhiteboardSync } from "../components/whiteboard/useWhiteboardSync";
import { CollabCursors, PresenceStack } from "../components/whiteboard/CollabCursors";
import Inspector from "../components/whiteboard/Inspector";
import EmoteOverlay from "../components/emotes/EmoteOverlay";
import WhiteboardTimer from "../components/whiteboard/WhiteboardTimer";

const SAVE_DEBOUNCE_MS = 1200;

// Default node sizes used by the toolbar's "+ Sticky / + Text / + Rect
// / + Ellipse" buttons. We keep them small so they fit visually inside
// template zones without overflowing.
const DEFAULTS = {
  sticky:  { w: 160, h: 160 },
  text:    { w: 220, h: 60 },
  rect:    { w: 180, h: 100 },
  ellipse: { w: 180, h: 110 },
  diamond: { w: 150, h: 110 },
  shape:   { w: 180, h: 100 },
  goal:    { w: 240, h: 150 },
  frame:   { w: 280, h: 360 },
};

const DEFAULT_EDGE_OPTIONS = {
  type: "editable",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#0ea5e9" },
  style: { stroke: "#0ea5e9", strokeWidth: 2 },
};

// Map a grabbed handle (by id or position) back to the SOURCE handle on
// that side, so a drag-created edge leaves from the side you pulled from.
// Each side carries both a source ("t"/"r"/"b"/"l") and target
// ("tt"/"rt"/"bt"/"lt") handle.
const SIDE_FROM_ID = { t: "t", tt: "t", r: "r", rt: "r", b: "b", bt: "b", l: "l", lt: "l" };
const SIDE_FROM_POS = { top: "t", right: "r", bottom: "b", left: "l" };
// Fallback entry side: opposite the side the edge left the source from.
const OPPOSITE_TARGET = { t: "b", r: "l", b: "t", l: "r" };

// Toolbar icon button — themed tints per tool kind.
function ToolButton({ title, onClick, tone = "neutral", dark, children }) {
  const tones = {
    neutral: dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100",
    amber:   dark ? "text-amber-400 hover:bg-amber-500/15" : "text-amber-600 hover:bg-amber-50",
    sky:     dark ? "text-sky-400 hover:bg-sky-500/15" : "text-sky-600 hover:bg-sky-50",
    red:     dark ? "text-red-400 hover:bg-red-500/15" : "text-red-500 hover:bg-red-50",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

// Mini outline preview of a shape, for the picker + inspector.
function ShapePreview({ shape, w = 26, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <ShapeSvg shape={shape} w={w} h={h} fill="none" stroke="currentColor" sw={1.5} />
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
          dark ? "text-sky-400 hover:bg-sky-500/15" : "text-sky-600 hover:bg-sky-50"
        }`}
      >
        <Shapes className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2 rounded-2xl border shadow-lg grid grid-cols-5 gap-1 ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
            style={{ width: 220 }}
          >
            {SHAPES.map((s) => (
              <button
                key={s.key}
                type="button"
                title={s.label}
                onClick={() => { onPick(s.key); setOpen(false); }}
                className={`h-10 rounded-lg flex items-center justify-center ${
                  dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
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
  const [current, setCurrent] = useState(() => stickyHex(preferredStickyColor()));

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
        <span style={{ width: 18, height: 18, borderRadius: 4, background: current, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.18)" }} />
      </button>
      <button
        type="button"
        title="Choose sticky color"
        aria-label="Choose sticky color"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow ${
          dark ? "bg-[var(--color-surface)] text-slate-300 border border-[var(--color-border)]" : "bg-white text-slate-500 border border-slate-200"
        }`}
      >
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-10 top-0 z-20 p-2.5 rounded-2xl border shadow-lg ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
            style={{ width: 188 }}
          >
            <div className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
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
                    outline: current.toLowerCase() === hex.toLowerCase() ? "2px solid #f97316" : "none",
                    outlineOffset: 1,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)",
                  }}
                />
              ))}
            </div>
            <label
              className={`mt-2.5 flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}
            >
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : "#fde68a"}
                onChange={(e) => pick(e.target.value)}
                style={{ width: 24, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
              />
              Custom color
            </label>
          </div>
        </>
      )}
    </div>
  );
}

let _idSeq = 1;
function freshId(prefix) {
  // 36ms time + counter is plenty to avoid id collisions inside one
  // tab without dragging in a uuid dep just for this.
  return `${prefix}-${Date.now().toString(36)}-${_idSeq++}`;
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
  const { isAdmin } = useTeam();
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

  // Inline header edit state.
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  // Toggle for the floating emote reaction bar (per device). Peers'
  // emotes still render when off — only your bar is hidden.
  const [emoteBarOn, setEmoteBarOn] = useState(() => {
    try { return localStorage.getItem("ql_wb_emote_bar") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ql_wb_emote_bar", emoteBarOn ? "1" : "0"); } catch { /* */ }
  }, [emoteBarOn]);

  // Track the board's own size (only when embedded) to toggle compact chrome.
  useEffect(() => {
    if (!embedded) { setCompact(false); return; }
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
  const myName = settings?.name || session?.user?.user_metadata?.name || session?.user?.email?.split("@")[0] || "";

  // ── live collaboration: broadcast node/edge diffs + cursors on top of
  // the snapshot-of-record, plus presence. See useWhiteboardSync.
  const { peers, members, pushCursor } = useWhiteboardSync({
    boardId: board?.id,
    enabled: !loading && !!board?.id,
    nodes, edges, setNodes, setEdges,
    name: myName,
  });
  const onWbPointerMove = useCallback((e) => {
    try { const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); pushCursor(p.x, p.y); }
    catch { /* */ }
  }, [rf, pushCursor]);

  // ── load board metadata + snapshot, seed template if empty ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!boardId) return;
      setLoading(true); setError("");
      const { data, error: err } = await fetchWhiteboardById(boardId);
      if (cancelled) return;
      if (err || !data) {
        setError(err?.message || "Whiteboard not found.");
        setBoard(null); setLoading(false);
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
      setNodes(snap.nodes || []);
      setEdges(snap.edges || []);
      // Stamp our baseline so the first save-tick doesn't round-trip
      // the snapshot we just loaded.
      lastSavedRef.current = JSON.stringify(snap);
      setLoading(false);
      // Defer fitView to after layout settles.
      setTimeout(() => {
        try { rf.fitView({ padding: 0.15, duration: 0 }); } catch { /* */ }
      }, 60);
    }
    load();
    return () => { cancelled = true; };
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
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [nodes, edges, board?.id, loading]);

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
  const onConnectEnd = useCallback((event, connectionState) => {
    const started = connectingRef.current;
    connectingRef.current = null;
    const srcNode = connectionState?.fromNode;
    const fromNodeId = srcNode?.id ?? started?.nodeId;
    if (!fromNodeId) return;
    const fromHandle = connectionState?.fromHandle;
    const sourceHandle =
      SIDE_FROM_ID[fromHandle?.id] ??
      SIDE_FROM_ID[started?.handleId] ??
      SIDE_FROM_POS[fromHandle?.position] ?? "r";
    const ev = "changedTouches" in event ? event.changedTouches[0] : event;
    if (ev?.clientX == null) return;
    let pos;
    try { pos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }); }
    catch { return; }

    // What node did we release over? (skip containers; small margin so a
    // drop right on the border still counts.)
    const M2 = 8;
    const overNode = rf.getNodes().find((n) => {
      if (n.type === "frame" || n.type === "zone") return false;
      const r = nodeRect(n);
      return r && pos.x >= r.x - M2 && pos.x <= r.x + r.w + M2 && pos.y >= r.y - M2 && pos.y <= r.y + r.h + M2;
    });

    // Released over ANOTHER node → connect to it AT THE DROP POINT (snap to
    // any side, not just the 4 handles). The source end uses where the pull
    // began on the source node, so both ends sit where you grabbed/let go.
    if (overNode && overNode.id !== fromNodeId) {
      const targetAnchor = projectToPerimeter(nodeRect(overNode), pos.x, pos.y);
      let sourceAnchor;
      const sRect = nodeRect(srcNode);
      if (sRect && started?.sx != null) {
        try {
          const sp = rf.screenToFlowPosition({ x: started.sx, y: started.sy });
          sourceAnchor = projectToPerimeter(sRect, sp.x, sp.y);
        } catch { /* */ }
      }
      setEdges((eds) => addEdge({
        source: fromNodeId,
        sourceHandle,
        target: overNode.id,
        targetHandle: ANCHOR_TO_HANDLE[targetAnchor.side],
        data: { ...(sourceAnchor ? { sourceAnchor } : {}), targetAnchor },
        ...DEFAULT_EDGE_OPTIONS,
      }, eds));
      return;
    }

    // New node mirrors the parent (fall back to a default process box).
    const isShapeParent = ["shape", "rect", "ellipse", "diamond"].includes(srcNode?.type);
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
    const nearParent = hasGeom &&
      pos.x >= sx0 - M && pos.x <= sx0 + size.w + M &&
      pos.y >= sy0 - M && pos.y <= sy0 + size.h + M;
    let place;
    if (hasGeom && nearParent) {
      place = siblingPlacement({ x: sx0, y: sy0, w: size.w, h: size.h }, sourceHandle, size);
    } else if (hasGeom) {
      const center = { x: sx0 + size.w / 2, y: sy0 + size.h / 2 };
      place = connectedNodePlacement(center, pos.x, pos.y, size);
    } else {
      place = { x: pos.x - size.w / 2, y: pos.y - size.h / 2, side: sourceHandle ? OPPOSITE_TARGET[sourceHandle] : "l" };
    }

    const newId = freshId("shape");
    markNodeForEdit(newId); // open the new node straight into text edit
    // Auto-select the new node (and deselect the rest) so its inspector
    // pops immediately — pull, drop, restyle.
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat({
      id: newId,
      type: "shape",
      position: { x: place.x, y: place.y },
      width: size.w, height: size.h,
      data: newData,
      selected: true,
    }));
    setEdges((eds) => addEdge({
      source: fromNodeId,
      sourceHandle,
      target: newId,
      targetHandle: place.side,
      ...DEFAULT_EDGE_OPTIONS,
    }, eds));
  }, [rf, setNodes, setEdges]);

  // Drag an edge endpoint onto a different node to re-route it.
  const onReconnect = useCallback((oldEdge, newConnection) => {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
  }, [setEdges]);

  // Frame containers: when a node is dropped inside a frame, adopt it as a
  // child (so it moves with the frame); when dragged out, release it.
  const onNodeDragStop = useCallback((_evt, node) => {
    if (!node || node.type === "frame" || node.type === "zone") return;
    setNodes((nds) => {
      const byId = new Map(nds.map((n) => [n.id, n]));
      const cur = byId.get(node.id);
      if (!cur) return nds;
      const abs = nodeAbsPos(cur, byId);
      const center = { x: abs.x + (cur.width || 0) / 2, y: abs.y + (cur.height || 0) / 2 };
      const hit = frameAt(center, nds, byId, node.id);
      let changed = false;
      const next = nds.map((n) => {
        if (n.id !== node.id) return n;
        if (hit && n.parentId !== hit.frame.id) {
          changed = true;
          return { ...n, parentId: hit.frame.id, extent: "parent", position: { x: abs.x - hit.fp.x, y: abs.y - hit.fp.y } };
        }
        if (!hit && n.parentId) {
          changed = true;
          return { ...n, parentId: undefined, extent: undefined, position: abs };
        }
        return n;
      });
      return changed ? sortParentsFirst(next) : nds;
    });
  }, [setNodes]);

  const addNodeAtCenter = useCallback((type, extra = {}) => {
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
    } catch { /* */ }
    const sized = ["shape", "goal", "frame", "rect", "ellipse", "diamond"].includes(type);
    const node = {
      id: freshId(type),
      type,
      position: { x: centerWorld.x - size.w / 2, y: centerWorld.y - size.h / 2 },
      data: type === "sticky" ? { text: "", color: extra.color || preferredStickyColor(), author: myName } : { text: "", ...extra },
      ...(sized ? { width: size.w, height: size.h } : {}),
      ...(type === "frame" ? { zIndex: -1 } : {}),
    };
    markNodeForEdit(node.id); // newly placed node opens straight into edit
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat({ ...node, selected: true }));
  }, [rf, setNodes, myName]);

  const deleteSelected = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.has(n.id) && n.type !== "zone"));
    setEdges((eds) => eds.filter((e) => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target)));
  }, [nodes, edges, setNodes, setEdges]);

  // ── selection inspector ──
  const selectedNode = useMemo(() => nodes.find((n) => n.selected && n.type !== "zone") || null, [nodes]);
  const selectedEdge = useMemo(() => (selectedNode ? null : edges.find((e) => e.selected) || null), [edges, selectedNode]);

  const patchNodeData = useCallback((patch) => {
    setNodes((nds) => nds.map((n) => (n.selected && n.type !== "zone") ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [setNodes]);

  // Title / goal / archive — same flow as the prior page, just leaning
  // on the existing setters in lib/whiteboard.
  async function handleSaveTitle() {
    if (!board) return;
    const next = titleDraft.trim() || "Untitled whiteboard";
    const { error: err } = await setWhiteboardTitle(board.id, next);
    if (err) { setError(err.message || "Couldn't save title."); return; }
    setBoard((b) => (b ? { ...b, title: next } : b));
    setTitleEditing(false);
  }
  async function handleSaveGoal() {
    if (!board) return;
    const next = goalDraft.trim();
    const { error: err } = await setWhiteboardGoal(board.id, next);
    if (err) { setError(err.message || "Couldn't save goal."); return; }
    setBoard((b) => (b ? { ...b, goal: next } : b));
    setGoalEditing(false);
  }
  async function handleArchive() {
    if (!board) return;
    if (!window.confirm("Archive this whiteboard? It'll disappear from the list — you can restore later.")) return;
    const { error: err } = await archiveWhiteboard(board.id);
    if (err) { setError(err.message || "Couldn't archive."); return; }
    navigate("/whiteboards");
  }

  const template = useMemo(
    () => board?.template_key ? TEMPLATES[board.template_key] : null,
    [board?.template_key],
  );

  // ── early returns ──
  const frameCls = embedded ? "w-full h-full p-4 space-y-3" : "px-4 pt-6 pb-6 max-w-[1400px] mx-auto space-y-3";
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
          <Link to="/whiteboards" className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
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
    saveState === "saved" ? "Saved" :
    saveState === "saving" ? "Saving…" :
    saveState === "dirty" ? "Unsaved" : "";

  return (
    <main
      ref={mainRef}
      // Subtract the nav bar (3.5rem mobile / 4rem desktop) AND the top
      // safe-area inset. Without the env() term the canvas is ~59px too tall
      // on Dynamic Island phones, which pushes the top timer ribbon under the
      // nav and the bottom emote/emoji island below the fold (you'd have to
      // scroll to reach it). env() resolves to 0 on desktop, so it's a no-op
      // there.
      className={`relative w-full overflow-hidden ${embedded ? "h-full" : "h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] sm:h-[calc(100dvh-4rem-env(safe-area-inset-top))]"}`}
      onPointerMove={onWbPointerMove}
    >
        <EdgeMarkerDefs />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          onNodeDragStop={onNodeDragStop}
          connectionMode={ConnectionMode.Loose}
          connectionLineComponent={ConnectionLine}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          panActivationKeyCode="Alt"
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          style={{ background: dark ? "#0f172a" : "#fbf6ee" }}
        >
          <Background gap={26} size={1.6} color={dark ? "rgba(255,255,255,.06)" : "rgba(120,80,20,.14)"} />
          <Controls position="bottom-left" />
          {!compact && <MiniMap pannable zoomable position="bottom-right" />}
          <CollabCursors peers={peers} />
          <PresenceStack members={members} dark={dark} />

          <Panel
            position="center-left"
            className={`flex flex-col items-center gap-0.5 p-1 rounded-2xl border shadow-sm ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
          >
            <StickyTool dark={dark} onAdd={(hex) => addNodeAtCenter("sticky", hex ? { color: hex } : {})} />
            <ToolButton title="Add text" tone="neutral" dark={dark} onClick={() => addNodeAtCenter("text")}>
              <Type className="w-4 h-4" />
            </ToolButton>
            <div className={`h-px w-5 my-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
            <ShapesMenu dark={dark} onPick={(shape) => addNodeAtCenter("shape", { shape })} />
            <ToolButton title="Add goal" tone="amber" dark={dark} onClick={() => addNodeAtCenter("goal")}>
              <Target className="w-4 h-4" />
            </ToolButton>
            <ToolButton title="Add frame / section" tone="neutral" dark={dark} onClick={() => addNodeAtCenter("frame")}>
              <Frame className="w-4 h-4" />
            </ToolButton>
            <div className={`h-px w-5 my-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
            <ToolButton title="Delete selected" tone="red" dark={dark} onClick={deleteSelected}>
              <Trash2 className="w-4 h-4" />
            </ToolButton>
          </Panel>

          {/* Node inspector (shape/fill/border/text) hovers above the
              selected node, like the edge toolbar. Edges use their own
              floating contextual toolbar (rendered on the edge itself). */}
          {selectedNode && (
            <NodeToolbar nodeId={selectedNode.id} isVisible position={Position.Top} offset={14} align="center">
              <Inspector node={selectedNode} patchNodeData={patchNodeData} />
            </NodeToolbar>
          )}
        </ReactFlow>

        {/* Breadcrumb / board chrome — a floating card pinned top-left,
            like the timer. Holds back-nav, title, template badge, save
            state, the reactions-bar toggle, and archive. */}
        <div className="absolute left-3 top-3 z-40 flex flex-col gap-2 items-start max-w-[calc(100%-24px)]">
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-2xl border shadow-md"
            style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
          >
            {!embedded && (
              <>
                <Link
                  to="/whiteboards"
                  title="Back to whiteboards"
                  className={`inline-flex items-center gap-1 text-xs shrink-0 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Link>
                <div className={`w-px h-4 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
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
                    else if (e.key === "Escape") { setTitleDraft(board.title); setTitleEditing(false); }
                  }}
                  className={`rounded-md border px-2 py-0.5 text-sm font-bold w-44 ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-300 text-slate-800"}`}
                />
                <Button size="sm" onClick={handleSaveTitle} className="h-7">Save</Button>
                <Button size="sm" variant="outline" onClick={() => { setTitleDraft(board.title); setTitleEditing(false); }} className="h-7">Cancel</Button>
              </div>
            ) : (
              <span
                className={`text-sm font-bold inline-flex items-center gap-1.5 cursor-text max-w-[220px] ${dark ? "text-slate-100" : "text-slate-800"}`}
                onDoubleClick={() => setTitleEditing(true)}
                title="Double-click to rename"
              >
                <span className="truncate">{board.title}</span>
                <button type="button" onClick={() => setTitleEditing(true)} className={`opacity-50 hover:opacity-100 shrink-0 ${dark ? "text-slate-300" : "text-slate-500"}`} title="Rename">
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
              <span className={`text-[11px] shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>{saveLabel}</span>
            )}
            {!compact && (
              <>
                <div className={`w-px h-4 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
                <button
                  type="button"
                  onClick={() => setEmoteBarOn((v) => !v)}
                  title={emoteBarOn ? "Hide reactions bar" : "Show reactions bar"}
                  aria-label={emoteBarOn ? "Hide reactions bar" : "Show reactions bar"}
                  aria-pressed={emoteBarOn}
                  className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${emoteBarOn ? "text-[var(--color-accent)] bg-[var(--color-accent-light)]" : dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
                >
                  <Smile className="w-4 h-4" />
                </button>
              </>
            )}
            {isAdmin && !embedded && (
              <button
                type="button"
                onClick={handleArchive}
                title="Archive whiteboard"
                aria-label="Archive whiteboard"
                className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors shrink-0 ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
              >
                <Archive className="w-4 h-4" />
              </button>
            )}
          </div>
          {error && (
            <div className={`text-xs font-medium px-3 py-1.5 rounded-lg shadow ${dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"}`}>
              {error}
            </div>
          )}
        </div>

        {/* Top overlay — Weekly Review's signature goal banner (when
            the template opts in) sitting next to the hero focus-timer
            ribbon. Both pinned over the canvas; pointer-events:none on
            the wrapper so clicks pass through except on the chips. */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-3 z-30 flex items-stretch gap-3 max-w-[calc(100%-32px)]"
          style={{ pointerEvents: "none" }}
        >
          {template?.hasGoal && !compact && (
            <div
              className="flex items-center gap-3 pl-3 pr-4 py-2 rounded-2xl shadow-md min-w-0 max-w-[520px]"
              style={{
                background: "linear-gradient(120deg, #f97316, #fb7a1a 70%, #ea580c)",
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
                      onClick={() => { setGoalDraft(board.goal || ""); setGoalEditing(true); }}
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
                        else if (e.key === "Escape") { setGoalDraft(board.goal || ""); setGoalEditing(false); }
                      }}
                      placeholder="Write your team goal…"
                      className="flex-1 bg-white/15 rounded-md px-2 py-1 text-sm text-white placeholder-white/60 outline-none focus:bg-white/25"
                    />
                    <button type="button" onClick={handleSaveGoal} className="h-7 px-2.5 rounded-md bg-white text-orange-700 text-xs font-bold">Save</button>
                    <button type="button" onClick={() => { setGoalDraft(board.goal || ""); setGoalEditing(false); }} className="h-7 px-2.5 rounded-md bg-white/15 text-white text-xs font-bold">Cancel</button>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[14px] font-bold tracking-tight text-white truncate max-w-[470px]">
                    {board.goal || "Click edit to set a goal…"}
                  </p>
                )}
              </div>
            </div>
          )}
          <WhiteboardTimer boardId={board.id} dark={dark} />
        </div>

        {/* Floating-emote layer scoped to this whiteboard. Same scope
            key on every client → emotes broadcast peer-to-peer. The bar
            is toggleable; peers' emotes still render when it's hidden. */}
        <EmoteOverlay
          channelKey={`whiteboard:${board.id}`}
          barPosition={emoteBarOn && !compact ? "bottom-center" : "hidden"}
        />
    </main>
  );
}
