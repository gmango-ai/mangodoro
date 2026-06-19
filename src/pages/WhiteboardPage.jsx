import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Panel, MiniMap,
  useNodesState, useEdgesState, addEdge, reconnectEdge, useReactFlow, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Target, Pencil, Archive, StickyNote, Type,
  Square, Circle, Diamond, Trash2,
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
import { NODE_TYPES } from "../components/whiteboard/nodes";
import { EDGE_TYPES } from "../components/whiteboard/edges";
import EmoteOverlay from "../components/emotes/EmoteOverlay";
import HeroTimerRibbon from "../components/whiteboard/HeroTimerRibbon";

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

let _idSeq = 1;
function freshId(prefix) {
  // 36ms time + counter is plenty to avoid id collisions inside one
  // tab without dragging in a uuid dep just for this.
  return `${prefix}-${Date.now().toString(36)}-${_idSeq++}`;
}

export default function WhiteboardPage() {
  // Wrap the actual editor in ReactFlowProvider so the toolbar/buttons
  // outside <ReactFlow /> can still call useReactFlow().
  return (
    <ReactFlowProvider>
      <WhiteboardEditor />
    </ReactFlowProvider>
  );
}

function WhiteboardEditor() {
  const { whiteboardId } = useParams();
  const { theme } = useTheme();
  const { isAdmin } = useTeam();
  const navigate = useNavigate();
  const dark = theme === "dark";

  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Inline header edit state.
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");

  const lastSavedRef = useRef("");
  const saveTimerRef = useRef(null);
  const seededRef = useRef(false);
  const [saveState, setSaveState] = useState("idle"); // idle | dirty | saving | saved

  const rf = useReactFlow();
  const connectingRef = useRef(null);

  // ── load board metadata + snapshot, seed template if empty ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!whiteboardId) return;
      setLoading(true); setError("");
      const { data, error: err } = await fetchWhiteboardById(whiteboardId);
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
  }, [whiteboardId]);

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
  const onConnect = useCallback((conn) => {
    setEdges((eds) => addEdge({ ...conn, ...DEFAULT_EDGE_OPTIONS }, eds));
  }, [setEdges]);

  const onConnectStart = useCallback((_evt, params) => {
    connectingRef.current = params; // { nodeId, handleId, handleType } — fallback
  }, []);

  // Drag a connector from a node onto empty canvas → spawn a connected
  // flow box right where you dropped. Pull, drop, type: the fastest way
  // to extend a flowchart (the xyflow "add node on edge drop" idiom).
  //
  // We use connectionState.fromNode rather than gating on handleType:
  // each side carries overlapping source+target handles (target on top,
  // for drop-to-connect), so a pull can start on either — what matters
  // is only WHICH node it came from.
  const onConnectEnd = useCallback((event, connectionState) => {
    const started = connectingRef.current;
    connectingRef.current = null;
    // Landed on a real handle → onConnect already made the edge.
    if (connectionState?.isValid) return;
    const fromNodeId = connectionState?.fromNode?.id ?? started?.nodeId;
    if (!fromNodeId) return;
    const fromHandle = connectionState?.fromHandle;
    const sourceHandle =
      SIDE_FROM_ID[fromHandle?.id] ??
      SIDE_FROM_ID[started?.handleId] ??
      SIDE_FROM_POS[fromHandle?.position];
    const ev = "changedTouches" in event ? event.changedTouches[0] : event;
    if (ev?.clientX == null) return;
    let pos;
    try { pos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }); }
    catch { return; }
    const size = DEFAULTS.rect;
    const newId = freshId("rect");
    setNodes((nds) => nds.concat({
      id: newId,
      type: "rect",
      position: { x: pos.x - size.w / 2, y: pos.y - size.h / 2 },
      width: size.w, height: size.h,
      data: { text: "" },
    }));
    setEdges((eds) => addEdge({
      source: fromNodeId,
      sourceHandle,
      target: newId,
      ...DEFAULT_EDGE_OPTIONS,
    }, eds));
  }, [rf, setNodes, setEdges]);

  // Drag an edge endpoint onto a different node to re-route it.
  const onReconnect = useCallback((oldEdge, newConnection) => {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
  }, [setEdges]);

  const addNodeAtCenter = useCallback((type) => {
    const size = DEFAULTS[type] || { w: 200, h: 100 };
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
    const node = {
      id: freshId(type),
      type,
      position: { x: centerWorld.x - size.w / 2, y: centerWorld.y - size.h / 2 },
      data: { text: "" },
      ...(type === "rect" || type === "ellipse" || type === "diamond" ? { width: size.w, height: size.h } : {}),
      ...(type === "sticky" ? { data: { text: "", color: "yellow" } } : {}),
    };
    setNodes((nds) => [...nds, node]);
  }, [rf, setNodes]);

  const deleteSelected = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.has(n.id) && n.type !== "zone"));
    setEdges((eds) => eds.filter((e) => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target)));
  }, [nodes, edges, setNodes, setEdges]);

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
  if (loading) {
    return (
      <main className="px-4 pt-6 pb-6 max-w-[1400px] mx-auto space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[640px] w-full" />
      </main>
    );
  }
  if (!board) {
    return (
      <main className="px-4 pt-6 pb-6 max-w-[1400px] mx-auto space-y-3">
        <Link to="/whiteboards" className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
          <ArrowLeft className="w-4 h-4" /> Back to whiteboards
        </Link>
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
    <main className="px-4 pt-4 pb-4 max-w-[1400px] mx-auto">
      {/* Header — back, title, template badge, save indicator. */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <Link
          to="/whiteboards"
          className={`inline-flex items-center gap-1 text-xs ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
        >
          <ArrowLeft className="w-3 h-3" /> Whiteboards
        </Link>
        {titleEditing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value.slice(0, 120))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                else if (e.key === "Escape") { setTitleDraft(board.title); setTitleEditing(false); }
              }}
              className={`rounded-md border px-2 py-1 text-lg font-bold ${
                dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-300 text-slate-800"
              }`}
            />
            <Button size="sm" onClick={handleSaveTitle}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setTitleDraft(board.title); setTitleEditing(false); }}>Cancel</Button>
          </div>
        ) : (
          <h1
            className={`text-lg font-bold inline-flex items-center gap-2 cursor-text ${dark ? "text-slate-100" : "text-slate-800"}`}
            onDoubleClick={() => setTitleEditing(true)}
            title="Double-click to rename"
          >
            {board.title}
            <button
              type="button"
              onClick={() => setTitleEditing(true)}
              className={`opacity-50 hover:opacity-100 ${dark ? "text-slate-300" : "text-slate-500"}`}
              title="Rename"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </h1>
        )}
        {template && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            {template.name}
          </span>
        )}
        <span className={`ml-auto text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {saveLabel}
        </span>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={handleArchive} className="h-7 text-xs">
            <Archive className="w-3.5 h-3.5 mr-1" />
            Archive
          </Button>
        )}
      </div>

      {error && (
        <div className={`text-xs font-medium px-3 py-1.5 rounded-lg mb-2 ${
          dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
        }`}>
          {error}
        </div>
      )}

      {/* Canvas — relative wrapper so the goal banner, hero timer
          ribbon, and EmoteOverlay can absolute-position themselves
          over the same bounds. */}
      <div
        className="relative h-[720px] rounded-2xl overflow-hidden border"
        style={{ borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          style={{ background: dark ? "#0f172a" : "#fbf6ee" }}
        >
          <Background gap={26} size={1.6} color={dark ? "rgba(255,255,255,.06)" : "rgba(120,80,20,.14)"} />
          <Controls position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" />

          <Panel
            position="top-left"
            className={`flex items-center gap-0.5 p-1 rounded-full border shadow-sm ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
          >
            <ToolButton title="Add sticky note" tone="amber" dark={dark} onClick={() => addNodeAtCenter("sticky")}>
              <StickyNote className="w-4 h-4" />
            </ToolButton>
            <ToolButton title="Add text" tone="neutral" dark={dark} onClick={() => addNodeAtCenter("text")}>
              <Type className="w-4 h-4" />
            </ToolButton>
            <div className={`w-px h-5 mx-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
            <ToolButton title="Add rectangle" tone="sky" dark={dark} onClick={() => addNodeAtCenter("rect")}>
              <Square className="w-4 h-4" />
            </ToolButton>
            <ToolButton title="Add ellipse" tone="sky" dark={dark} onClick={() => addNodeAtCenter("ellipse")}>
              <Circle className="w-4 h-4" />
            </ToolButton>
            <ToolButton title="Add decision (diamond)" tone="sky" dark={dark} onClick={() => addNodeAtCenter("diamond")}>
              <Diamond className="w-4 h-4" />
            </ToolButton>
            <div className={`w-px h-5 mx-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
            <ToolButton title="Delete selected" tone="red" dark={dark} onClick={deleteSelected}>
              <Trash2 className="w-4 h-4" />
            </ToolButton>
          </Panel>
        </ReactFlow>

        {/* Top overlay — Weekly Review's signature goal banner (when
            the template opts in) sitting next to the hero focus-timer
            ribbon. Both pinned over the canvas; pointer-events:none on
            the wrapper so clicks pass through except on the chips. */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-3 z-30 flex items-stretch gap-3 max-w-[calc(100%-32px)]"
          style={{ pointerEvents: "none" }}
        >
          {template?.hasGoal && (
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
          <HeroTimerRibbon />
        </div>

        {/* Floating-emote layer scoped to this whiteboard. Same scope
            key on every client → emotes broadcast peer-to-peer. */}
        <EmoteOverlay channelKey={`whiteboard:${board.id}`} />
      </div>
    </main>
  );
}
