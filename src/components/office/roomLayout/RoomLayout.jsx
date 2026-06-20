import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../../../context/ThemeContext";
import { ROOM_PANELS } from "./panels";
import { computeLayout, MIN_PX } from "./layoutTree";

// Which region of a tile the cursor is over: the middle ~third both ways
// is "center" (swap); otherwise the nearest edge (split on that side).
function zoneFor(rect, px, py) {
  const fx = (px - rect.x) / rect.w;
  const fy = (py - rect.y) / rect.h;
  if (fx > 0.34 && fx < 0.66 && fy > 0.34 && fy < 0.66) return "center";
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

// Renders a room layout tree as absolutely-positioned tiles.
//
// Why absolute positioning instead of nested flex/splits: a panel's DOM
// node keeps the SAME parent no matter how the tree changes, so React
// never remounts it. That's what keeps the Jitsi call and the whiteboard
// alive across resizes AND rearranges. Each tile is keyed by its panel id,
// so a panel that survives a change is repositioned, not torn down.
//
// `arranging` flips on a drag-to-rearrange layer: drag a panel onto an
// edge of another to split there, or its center to swap. That layer is
// portalled to <body> as a fixed overlay so it sits above the persistent
// video call (a fixed iframe at z-150) instead of being occluded by it.
export default function RoomLayout({ tree, ctx, onRatioChange, arranging, onMove }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const containerRef = useRef(null);
  const [rect, setRect] = useState({ top: 0, left: 0, w: 0, h: 0 });
  const [drag, setDrag] = useState(null);     // divider resize: { path, dir, splitRect }
  const [moving, setMoving] = useState(null); // rearrange: { panel }
  const [drop, setDrop] = useState(null);     // { panel, zone, rect }
  const [pointer, setPointer] = useState(null);

  // Track the container's viewport rect; tile geometry uses w/h, the
  // portalled arrange layer uses top/left to align over the container.
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

  const { leaves, dividers } = computeLayout(tree, { x: 0, y: 0, w: rect.w, h: rect.h });

  // Keep live geometry + drop target in refs so the move listeners stay
  // subscribed across the re-renders they trigger.
  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;
  const dropRef = useRef(drop);
  dropRef.current = drop;

  // Nudge the persistent video call (and anything watching window resize)
  // to re-measure whenever a tile moves or resizes.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(id);
  }, [tree, rect.w, rect.h]);

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
      const minR = MIN_PX / total;
      const ratio = Math.max(minR, Math.min(1 - minR, local / total));
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

  // Rearrange drag → hit-test the hovered tile + zone, commit on release.
  useEffect(() => {
    if (!moving) return;
    const onPointerMove = (e) => {
      const c = containerRef.current?.getBoundingClientRect();
      if (!c) return;
      const px = e.clientX - c.left, py = e.clientY - c.top;
      setPointer({ x: px, y: py });
      const hit = leavesRef.current.find(
        (l) => px >= l.rect.x && px <= l.rect.x + l.rect.w && py >= l.rect.y && py <= l.rect.y + l.rect.h,
      );
      if (!hit || hit.panel === moving.panel) { setDrop(null); return; }
      const zone = zoneFor(hit.rect, px, py);
      setDrop({ panel: hit.panel, zone, rect: zoneRect(hit.rect, zone) });
    };
    const onUp = () => {
      const d = dropRef.current;
      if (d) onMove?.(moving.panel, d.panel, d.zone);
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
  }, [moving, onMove]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-0 overflow-hidden">
      {leaves.map((l) => {
        const panel = ROOM_PANELS[l.panel];
        return (
          <div
            key={l.panel}
            className="absolute overflow-hidden"
            style={{ left: l.rect.x, top: l.rect.y, width: l.rect.w, height: l.rect.h }}
          >
            {panel ? panel.render(ctx) : null}
          </div>
        );
      })}

      {/* Resize handles — hidden while rearranging to keep the modes distinct. */}
      {!arranging && dividers.map((d) => {
        const horiz = d.dir === "row";
        return (
          <div
            key={`div:${d.path.join("") || "root"}`}
            role="separator"
            aria-orientation={horiz ? "vertical" : "horizontal"}
            onPointerDown={(e) => { e.preventDefault(); setDrag({ path: d.path, dir: d.dir, splitRect: d.splitRect }); }}
            className={`group absolute z-10 flex items-center justify-center transition-colors ${
              horiz ? "cursor-col-resize" : "cursor-row-resize"
            } ${drag ? "" : "hover:bg-[var(--color-accent)]/10"}`}
            style={{ left: d.rect.x, top: d.rect.y, width: d.rect.w, height: d.rect.h }}
          >
            <div
              className={`rounded-full transition-opacity opacity-30 group-hover:opacity-70 ${
                dark ? "bg-slate-400" : "bg-slate-500"
              } ${horiz ? "w-0.5 h-10" : "h-0.5 w-10"}`}
            />
          </div>
        );
      })}

      {/* Arrange layer — portalled to <body> as a fixed overlay aligned to
          the container, so it floats above the persistent video iframe. */}
      {arranging && rect.w > 0 && createPortal(
        <div
          className="fixed z-[200]"
          style={{ top: rect.top, left: rect.left, width: rect.w, height: rect.h, pointerEvents: "none" }}
        >
          {leaves.map((l) => {
            const panel = ROOM_PANELS[l.panel];
            const Icon = panel?.icon;
            const isMoving = moving?.panel === l.panel;
            return (
              <div
                key={`ov:${l.panel}`}
                onPointerDown={(e) => { e.preventDefault(); setMoving({ panel: l.panel }); setPointer({ x: l.rect.x + l.rect.w / 2, y: l.rect.y + l.rect.h / 2 }); }}
                className={`absolute flex flex-col items-center justify-center gap-1.5 rounded-xl cursor-grab active:cursor-grabbing select-none ${
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
                {Icon && <Icon className="w-5 h-5 text-[var(--color-accent)]" />}
                <span className={`text-[11px] font-semibold ${dark ? "text-slate-200" : "text-slate-600"}`}>{panel?.title || l.panel}</span>
                <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>drag to move</span>
              </div>
            );
          })}

          {drop && (
            <div
              className="absolute rounded-xl border-2"
              style={{
                left: drop.rect.x, top: drop.rect.y, width: drop.rect.w, height: drop.rect.h,
                background: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
                borderColor: "var(--color-accent)",
                pointerEvents: "none",
              }}
            />
          )}

          {moving && pointer && (
            <div
              className="absolute flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-lg text-[11px] font-semibold text-white"
              style={{ left: pointer.x + 12, top: pointer.y + 12, background: "var(--color-accent)", pointerEvents: "none" }}
            >
              {(() => { const Icon = ROOM_PANELS[moving.panel]?.icon; return Icon ? <Icon className="w-3.5 h-3.5" /> : null; })()}
              {ROOM_PANELS[moving.panel]?.title || moving.panel}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
