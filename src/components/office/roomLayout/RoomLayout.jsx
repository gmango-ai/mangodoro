import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, GripVertical, Maximize2, Minimize2 } from "lucide-react";
import { useTheme } from "../../../context/ThemeContext";
import { ROOM_PANELS } from "./panels";
import { computeLayout, MIN_PX } from "./layoutTree";

// Smallest comfortable size for a node: a leaf uses its panel-type `min`
// (panels.jsx); a split uses the larger of its children so the bigger panel
// still fits. Lets the resize clamp give whiteboard/video more room than chat.
function nodeMin(node, panels) {
  if (!node) return MIN_PX;
  if (node.t === "leaf") return panels[node.panel]?.min || MIN_PX;
  return Math.max(nodeMin(node.a, panels), nodeMin(node.b, panels));
}
function nodeAt(node, path) {
  let n = node;
  for (const step of path) {
    if (!n || n.t !== "split") return null;
    n = n[step];
  }
  return n;
}

const TILE_TRANSITION = "left .22s cubic-bezier(.4,0,.2,1), top .22s cubic-bezier(.4,0,.2,1), width .22s cubic-bezier(.4,0,.2,1), height .22s cubic-bezier(.4,0,.2,1)";

// Which region of a tile the cursor is over: the middle ~third both ways
// is "center" (swap); otherwise the nearest edge (split on that side).
function zoneFor(rect, px, py) {
  const fx = (px - rect.x) / rect.w;
  const fy = (py - rect.y) / rect.h;
  if (fx > 0.34 && fx < 0.66 && fy > 0.34 && fy < 0.66) return "center";
  return edgeFor(rect, px, py);
}
// Nearest edge — used when adding (no "swap into" makes sense).
function edgeFor(rect, px, py) {
  const fx = (px - rect.x) / rect.w;
  const fy = (py - rect.y) / rect.h;
  const d = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (d === fx) return "left";
  if (d === 1 - fx) return "right";
  if (d === fy) return "top";
  return "bottom";
}
function zoneRect(rect, zone) {
  const { x, y, w, h } = rect;
  switch (zone) {
    case "left": return { x, y, w: w / 2, h };
    case "right": return { x: x + w / 2, y, w: w / 2, h };
    case "top": return { x, y, w, h: h / 2 };
    case "bottom": return { x, y: y + h / 2, w, h: h / 2 };
    default: return { x, y, w, h };
  }
}
function hits(rect, px, py) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// Integrated "window chrome" for a tile: a slim title bar that IS the drag
// handle (grab anywhere), with the panel icon + title and right-aligned window
// controls (maximize/restore, close, plus any per-panel `extra`). Replaces the
// old floating grip — being a child of the tile, it can't overlap content or
// "fall off". Buttons stop pointer propagation so a click doesn't start a drag.
function PanelHeader({ dark, icon: Icon, title, narrow, maximized, draggable, onDragStart, onToggleMax, onClose, extra }) {
  const btn = `p-1 rounded-md transition-colors ${
    dark ? "text-slate-400 hover:text-slate-100 hover:bg-white/10" : "text-slate-500 hover:text-slate-800 hover:bg-black/5"
  }`;
  return (
    <div
      onPointerDown={draggable ? onDragStart : undefined}
      title={draggable ? "Drag to move" : undefined}
      className={`group/hdr shrink-0 flex items-center gap-1.5 h-8 pl-2 pr-1 select-none border-b ${
        draggable ? "touch-none cursor-grab active:cursor-grabbing" : ""
      } ${dark ? "bg-[var(--color-surface-raised)]/70 border-[var(--color-border)] text-slate-300" : "bg-slate-50 border-slate-200 text-slate-500"}`}
    >
      <GripVertical
        className={`w-3.5 h-3.5 shrink-0 ${draggable ? "" : "opacity-0"} ${
          dark ? "text-slate-600 group-hover/hdr:text-slate-400" : "text-slate-300 group-hover/hdr:text-slate-500"
        }`}
      />
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]" />}
      {!narrow && <span className="text-[11px] font-semibold truncate">{title}</span>}
      <span className="flex-1" />
      <div className="flex items-center gap-0.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
        {extra}
        <button
          type="button"
          className={btn}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore panel" : "Maximize panel"}
          onClick={onToggleMax}
        >
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        {onClose && (
          <button type="button" className={btn} title="Close panel" aria-label="Close panel" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// Renders a room layout tree as absolutely-positioned tiles.
//
// Tiles are KEYED BY PANEL ID and never change DOM parent, so React never
// remounts a panel — the video call and whiteboard survive resize AND
// rearrange. Position/size animate via CSS; during the animation we pump
// resize events so the persistent video host stays glued to its tile.
//
// `arranging` flips on a drag layer (portalled to <body> so it floats
// above the fixed video host). In it you can: drag a tile onto another's
// edge to split / center to swap; drag a tile into the toolbox to remove
// it; or drag a panel out of the toolbox onto a tile edge to add it.
export default function RoomLayout({ tree, ctx, panels = ROOM_PANELS, onRatioChange, arranging, onMove, onAddAt, onMoveToRoot, onAddAtRoot, onClose, dark: darkProp, locked = false }) {
  const { theme } = useTheme();
  // Explicit `dark` wins (the kiosk is always dark but doesn't drive ThemeContext,
  // which otherwise left the tile chrome rendering light on a dark display).
  const dark = darkProp ?? (theme === "dark");
  const containerRef = useRef(null);
  const toolboxRef = useRef(null);
  const [rect, setRect] = useState({ top: 0, left: 0, w: 0, h: 0 });
  const [settled, setSettled] = useState(false);
  const [drag, setDrag] = useState(null);     // divider resize: { path, dir, splitRect }
  const [moving, setMoving] = useState(null); // drag: { panel, fromToolbox }
  const [drop, setDrop] = useState(null);     // { kind:"tile", panel, zone } | { kind:"toolbox" }
  const [pointer, setPointer] = useState(null);
  const [maximized, setMaximized] = useState(null); // panel id rendered full-tile

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, []);

  useEffect(() => {
    if (rect.w > 0 && !settled) {
      const id = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(id);
    }
  }, [rect.w, settled]);

  const { leaves, dividers } = computeLayout(tree, { x: 0, y: 0, w: rect.w, h: rect.h });
  const shown = new Set(leaves.map((l) => l.panel));
  // Web tiles are managed by shared room state (add via the header, close via
  // the tile), so they never appear as draggable toolbox chips.
  const hidden = Object.keys(panels).filter((id) => !shown.has(id) && !id.startsWith("web:"));
  const canClose = leaves.length > 1;
  // Ignore a stale maximize if that panel was since closed.
  const maximizedPanel = maximized && shown.has(maximized) ? maximized : null;
  const animate = settled && !drag && !moving;

  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;
  const dropRef = useRef(drop);
  dropRef.current = drop;

  // Keep the persistent video call glued to its tile through animations.
  useEffect(() => {
    if (drag) return;
    let raf, start = null;
    const tick = (t) => {
      if (start === null) start = t;
      window.dispatchEvent(new Event("resize"));
      if (t - start < 260) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tree, rect.w, rect.h, drag]);

  // Divider drag → recompute the parent split's ratio from the pointer.
  useEffect(() => {
    if (!drag) return;
    const onPointerMove = (e) => {
      const c = containerRef.current?.getBoundingClientRect();
      if (!c) return;
      const { path, dir, splitRect } = drag;
      const horiz = dir === "row";
      const total = horiz ? splitRect.w : splitRect.h;
      if (total <= 0) return;
      const local = horiz ? e.clientX - c.left - splitRect.x : e.clientY - c.top - splitRect.y;
      // Per-side minimums: child `a` and child `b` each keep their own floor
      // (a whiteboard side can't be squeezed as small as a chat side).
      const minRa = (drag.minA ?? MIN_PX) / total;
      const minRb = (drag.minB ?? MIN_PX) / total;
      const ratio = Math.max(minRa, Math.min(1 - minRb, local / total));
      onRatioChange(path, ratio);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = drag.dir === "row" ? "col-resize" : "row-resize";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [drag, onRatioChange]);

  // Unified arrange drag (move / add / remove). Hit-tests the toolbox first
  // (remove), then tiles (split / swap / add), commits on release.
  useEffect(() => {
    if (!moving) return;
    const onPointerMove = (e) => {
      const c = containerRef.current?.getBoundingClientRect();
      if (!c) return;
      const px = e.clientX - c.left, py = e.clientY - c.top;
      setPointer({ x: px, y: py });

      // Drag a shown tile into the toolbox to remove it.
      if (!moving.fromToolbox && leavesRef.current.length > 1) {
        const tb = toolboxRef.current?.getBoundingClientRect();
        if (tb && e.clientX >= tb.left && e.clientX <= tb.right && e.clientY >= tb.top && e.clientY <= tb.bottom) {
          setDrop({ kind: "toolbox" });
          return;
        }
      }
      // Near the OUTER edge of the whole layout → a full-span root banner
      // (stretch across the entire top/bottom or the full-height left/right),
      // as long as there's more than one tile to span over.
      const M = 24;
      if (leavesRef.current.length > 1) {
        const nl = px < M, nr = px > c.width - M, nt = py < M, nb = py > c.height - M;
        if (nl || nr || nt || nb) {
          const dl = nl ? px : Infinity, dr = nr ? c.width - px : Infinity, dt = nt ? py : Infinity, db = nb ? c.height - py : Infinity;
          const m = Math.min(dl, dr, dt, db);
          const side = m === dt ? "top" : m === db ? "bottom" : m === dl ? "left" : "right";
          setDrop({ kind: "root", side });
          return;
        }
      }
      const hit = leavesRef.current.find((l) => hits(l.rect, px, py));
      if (!hit || (!moving.fromToolbox && hit.panel === moving.panel)) { setDrop(null); return; }
      const zone = moving.fromToolbox ? edgeFor(hit.rect, px, py) : zoneFor(hit.rect, px, py);
      setDrop({ kind: "tile", panel: hit.panel, zone });
    };
    const onUp = () => {
      const d = dropRef.current;
      if (d) {
        if (d.kind === "root" && moving.fromToolbox) onAddAtRoot?.(moving.panel, d.side);
        else if (d.kind === "root") onMoveToRoot?.(moving.panel, d.side);
        else if (d.kind === "toolbox" && !moving.fromToolbox) onClose?.(moving.panel);
        else if (d.kind === "tile" && moving.fromToolbox) onAddAt?.(moving.panel, d.panel, d.zone);
        else if (d.kind === "tile") onMove?.(moving.panel, d.panel, d.zone);
      }
      setMoving(null); setDrop(null); setPointer(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
    };
  }, [moving, onMove, onAddAt, onMoveToRoot, onAddAtRoot, onClose]);

  const startTileDrag = (panel, e) => {
    e.preventDefault();
    const c = containerRef.current?.getBoundingClientRect();
    setMoving({ panel, fromToolbox: false });
    if (c) setPointer({ x: e.clientX - c.left, y: e.clientY - c.top });
  };
  const startChipDrag = (panel, e) => {
    e.preventDefault();
    const c = containerRef.current?.getBoundingClientRect();
    setMoving({ panel, fromToolbox: true });
    if (c) setPointer({ x: e.clientX - c.left, y: e.clientY - c.top });
  };

  const dropTarget = drop?.kind === "tile" ? leaves.find((l) => l.panel === drop.panel) : null;

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-0 overflow-hidden">
      {leaves.map((l) => {
        const panel = panels[l.panel];
        const Icon = panel?.icon;
        const isMax = maximizedPanel === l.panel;
        const r = isMax ? { x: 0, y: 0, w: rect.w, h: rect.h } : l.rect;
        const narrow = r.w < 200;
        // The video is a fixed overlay at z-20 glued to its content area. A
        // maximized VIDEO tile must sit BELOW it (z 10) so the video shows
        // through; any other maximized tile sits ABOVE it (z 30) to cover it.
        const z = isMax ? (l.panel === "video" ? 10 : 30) : undefined;
        return (
          <div
            key={l.panel}
            className={`absolute flex flex-col overflow-hidden rounded-xl shadow-sm border ${
              dark ? "border-[var(--color-border)]" : "border-slate-200"
            }`}
            style={{
              left: r.x, top: r.y, width: r.w, height: r.h, zIndex: z,
              transition: animate ? TILE_TRANSITION : "none",
            }}
          >
            {/* Locked (kiosk display mode): drop the tile chrome for a clean,
                full-bleed view — no header, drag handle, or window controls. */}
            {!locked && (
              <PanelHeader
                dark={dark}
                icon={Icon}
                title={panel?.title || l.panel}
                narrow={narrow}
                maximized={isMax}
                draggable={!maximizedPanel}
                onDragStart={(e) => startTileDrag(l.panel, e)}
                onToggleMax={() => setMaximized(isMax ? null : l.panel)}
                onClose={canClose ? () => { if (isMax) setMaximized(null); onClose?.(l.panel); } : undefined}
                extra={panel?.headerActions ? panel.headerActions(ctx) : null}
              />
            )}
            <div className="relative flex-1 min-h-0">
              {panel ? panel.render(ctx) : null}
            </div>
          </div>
        );
      })}

      {/* Resize handles — available in normal AND arrange mode. They sit in
          the gaps between tiles; the arrange overlay passes pointer events
          through there, so dragging a divider still resizes while arranging. */}
      {!maximizedPanel && !locked && dividers.map((d) => {
        const horiz = d.dir === "row";
        return (
          <div
            key={`div:${d.path.join("") || "root"}`}
            role="separator"
            aria-orientation={horiz ? "vertical" : "horizontal"}
            // The visible gutter/grip stays slim; the real pointer target is an
            // enlarged invisible child (below) so the thin divider is grabbable
            // with a thumb.
            className={`group absolute z-10 flex items-center justify-center rounded-full transition-colors ${
              horiz ? "cursor-col-resize" : "cursor-row-resize"
            } ${drag ? "bg-[var(--color-accent)]/20" : "hover:bg-[var(--color-accent)]/12"}`}
            style={{ left: d.rect.x, top: d.rect.y, width: d.rect.w, height: d.rect.h }}
          >
            {/* Enlarged touch target — extends ~8px past the 12px gutter each
                side (≈28px zone). touch-none so a touch-drag resizes instead of
                the page scrolling. */}
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                const node = nodeAt(tree, d.path);
                setDrag({ path: d.path, dir: d.dir, splitRect: d.splitRect, minA: nodeMin(node?.a, panels), minB: nodeMin(node?.b, panels) });
              }}
              className={`absolute touch-none ${horiz ? "-inset-x-2 inset-y-0 cursor-col-resize" : "-inset-y-2 inset-x-0 cursor-row-resize"}`}
            />
            <div
              className={`pointer-events-none rounded-full transition-all group-hover:!opacity-90 group-hover:bg-[var(--color-accent)] ${
                drag ? "opacity-90 bg-[var(--color-accent)]"
                  : arranging ? "opacity-70 bg-[var(--color-accent)]"
                  : `opacity-40 ${dark ? "bg-slate-400" : "bg-slate-500"}`
              } ${horiz ? "w-1 h-12" : "h-1 w-12"}`}
            />
          </div>
        );
      })}

      {/* Arrange layer — portalled to <body> to float above the video iframe. */}
      {arranging && rect.w > 0 && createPortal(
        <div
          className="fixed z-[200]"
          style={{ top: rect.top, left: rect.left, width: rect.w, height: rect.h, pointerEvents: "none" }}
        >
          {leaves.map((l) => {
            const panel = panels[l.panel];
            const Icon = panel?.icon;
            const isMoving = moving?.panel === l.panel && !moving.fromToolbox;
            return (
              <div
                key={`ov:${l.panel}`}
                onPointerDown={(e) => startTileDrag(l.panel, e)}
                className={`absolute flex flex-col items-center justify-center gap-1.5 rounded-xl cursor-grab active:cursor-grabbing select-none touch-none ${
                  isMoving ? "ring-2 ring-[var(--color-accent)]" : ""
                }`}
                style={{
                  left: l.rect.x, top: l.rect.y, width: l.rect.w, height: l.rect.h,
                  background: dark ? "rgba(2,6,23,.55)" : "rgba(255,255,255,.55)",
                  backdropFilter: "blur(1px)",
                  opacity: isMoving ? 0.4 : 1,
                  pointerEvents: "auto",
                }}
              >
                {canClose && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onClose?.(l.panel)}
                    title={`Remove ${panel?.title || l.panel}`}
                    aria-label={`Remove ${panel?.title || l.panel}`}
                    className={`absolute top-1.5 right-1.5 w-9 h-9 rounded-full inline-flex items-center justify-center ${
                      dark ? "bg-white/10 text-slate-200 hover:bg-rose-500/30" : "bg-black/5 text-slate-600 hover:bg-rose-500/15 hover:text-rose-600"
                    }`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {Icon && <Icon className="w-5 h-5 text-[var(--color-accent)]" />}
                <span className={`text-[11px] font-semibold ${dark ? "text-slate-200" : "text-slate-600"}`}>{panel?.title || l.panel}</span>
                <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>drag to move</span>
              </div>
            );
          })}

          {/* Drop hint on the hovered tile. */}
          {dropTarget && (() => {
            const adding = moving?.fromToolbox;
            const full = !adding && drop.zone === "center";
            const r = full ? dropTarget.rect : zoneRect(dropTarget.rect, drop.zone);
            const label = adding ? `Add ${drop.zone}` : (drop.zone === "center" ? "Swap" : `Split ${drop.zone}`);
            return (
              <div
                className="absolute rounded-xl border-2 flex items-center justify-center"
                style={{
                  left: r.x, top: r.y, width: r.w, height: r.h,
                  background: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
                  borderColor: "var(--color-accent)", pointerEvents: "none",
                }}
              >
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "var(--color-accent)" }}>
                  {label}
                </span>
              </div>
            );
          })()}

          {/* Cursor-following ghost. */}
          {moving && pointer && (
            <div
              className="absolute flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-lg text-[11px] font-semibold text-white"
              style={{ left: pointer.x + 12, top: pointer.y + 12, background: "var(--color-accent)", pointerEvents: "none" }}
            >
              {(() => { const Icon = panels[moving.panel]?.icon; return Icon ? <Icon className="w-3.5 h-3.5" /> : null; })()}
              {panels[moving.panel]?.title || moving.panel}
            </div>
          )}

          {/* Toolbox: drag chips out to add, drag tiles in to remove. */}
          <div
            ref={toolboxRef}
            className={`absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2 px-3 py-2 rounded-2xl border shadow-xl transition-colors ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            } ${drop?.kind === "toolbox" ? "ring-2 ring-rose-500" : ""}`}
            style={{ pointerEvents: "auto" }}
          >
            {moving && !moving.fromToolbox ? (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-500 px-1">
                <Trash2 className="w-4 h-4" /> Drop here to remove
              </span>
            ) : (
              <>
                <span className={`text-[10px] font-bold uppercase tracking-wider pr-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>Panels</span>
                {hidden.length === 0 ? (
                  <span className={`text-[11px] px-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    All in use · drag a tile here to remove
                  </span>
                ) : hidden.map((id) => {
                  const p = panels[id];
                  const Icon = p?.icon;
                  const lifted = moving?.fromToolbox && moving.panel === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onPointerDown={(e) => startChipDrag(id, e)}
                      className={`flex items-center gap-1.5 px-3 h-9 rounded-full cursor-grab active:cursor-grabbing select-none touch-none transition-opacity ${
                        dark ? "bg-white/10 text-slate-200 hover:bg-white/15" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      } ${lifted ? "opacity-40" : ""}`}
                      title={`Add ${p?.title || id}`}
                    >
                      {Icon && <Icon className="w-3.5 h-3.5 text-[var(--color-accent)]" />}
                      <span className="text-[12px] font-semibold">{p?.title || id}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Quick-move feedback (OUTSIDE Arrange) — the live drop hint + cursor
          ghost while a tile is dragged by its header, portalled above the video
          so the panel can be dropped even over the call. The drag is started
          from each tile's header (PanelHeader); Arrange keeps the richer overlay
          (toolbox / add / remove). */}
      {!arranging && rect.w > 0 && createPortal(
        <div
          className="fixed z-[100]"
          style={{ top: rect.top, left: rect.left, width: rect.w, height: rect.h, pointerEvents: "none" }}
        >
          {/* Full-span root banner hint — a bar across the whole edge. */}
          {moving && drop?.kind === "root" && (() => {
            const t = 0.26;
            const r =
              drop.side === "top" ? { x: 0, y: 0, w: rect.w, h: rect.h * t } :
              drop.side === "bottom" ? { x: 0, y: rect.h * (1 - t), w: rect.w, h: rect.h * t } :
              drop.side === "left" ? { x: 0, y: 0, w: rect.w * t, h: rect.h } :
              { x: rect.w * (1 - t), y: 0, w: rect.w * t, h: rect.h };
            return (
              <div
                className="absolute rounded-xl border-2 border-dashed flex items-center justify-center"
                style={{
                  left: r.x, top: r.y, width: r.w, height: r.h,
                  background: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
                  borderColor: "var(--color-accent)", pointerEvents: "none",
                }}
              >
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "var(--color-accent)" }}>
                  Stretch across {drop.side}
                </span>
              </div>
            );
          })()}
          {moving && dropTarget && (() => {
            const full = drop.zone === "center";
            const r = full ? dropTarget.rect : zoneRect(dropTarget.rect, drop.zone);
            const label = drop.zone === "center" ? "Swap" : `Move ${drop.zone}`;
            return (
              <div
                className="absolute rounded-xl border-2 flex items-center justify-center"
                style={{
                  left: r.x, top: r.y, width: r.w, height: r.h,
                  background: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
                  borderColor: "var(--color-accent)", pointerEvents: "none",
                }}
              >
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "var(--color-accent)" }}>
                  {label}
                </span>
              </div>
            );
          })()}

          {moving && pointer && (
            <div
              className="absolute flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-lg text-[11px] font-semibold text-white"
              style={{ left: pointer.x + 12, top: pointer.y + 12, background: "var(--color-accent)", pointerEvents: "none" }}
            >
              {(() => { const Icon = panels[moving.panel]?.icon; return Icon ? <Icon className="w-3.5 h-3.5" /> : null; })()}
              {panels[moving.panel]?.title || moving.panel}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
