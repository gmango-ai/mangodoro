import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";

// Two-pane resizable split with a drag handle in between. The
// handle pointer-captures during drag so the user can fling past
// either pane's minimum to snap-close that pane — at which point
// we fire `onCollapseFirst` / `onCollapseSecond` so the parent can
// flip into a single-pane view mode.
//
// Snap rules (per side):
//   - normal drag: clamp position so neither pane goes below its min
//   - drag past that clamp by ≥ SNAP_BUFFER_PX: collapse the pane
//     that hit the minimum
//
// The clamped ratio is persisted to localStorage under `storageKey`
// so the user's preferred split survives reloads and view-mode
// toggles. Switching from stack → side keeps a separate ratio for
// each direction (the parent passes a different key).
//
//   direction = "vertical"   first = top    | second = bottom
//   direction = "horizontal" first = left   | second = right
const SNAP_BUFFER_PX = 60;

function loadSplit(key, def) {
  try {
    const v = parseFloat(localStorage.getItem(key));
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  } catch { /* */ }
  return def;
}
function saveSplit(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* */ }
}

export default function ResizableSplit({
  direction = "vertical",
  storageKey,
  defaultSplit = 0.55,
  minFirstPx = 240,
  minSecondPx = 200,
  onCollapseFirst,
  onCollapseSecond,
  children,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const containerRef = useRef(null);
  const isVertical = direction === "vertical";
  const [first, second] = Array.isArray(children) ? children : [children, null];

  const [split, setSplit] = useState(() => loadSplit(storageKey, defaultSplit));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e) => {
      const point = e.touches ? e.touches[0] : e;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const containerSize = isVertical ? rect.height : rect.width;
      const start = isVertical ? rect.top : rect.left;
      const cursor = isVertical ? point.clientY : point.clientX;
      const raw = (cursor - start) / containerSize;
      if (!Number.isFinite(raw)) return;

      const minFirstRatio = minFirstPx / containerSize;
      const maxFirstRatio = 1 - (minSecondPx / containerSize);
      const buffer = SNAP_BUFFER_PX / containerSize;

      // Past min for the first pane — collapse it.
      if (raw < minFirstRatio - buffer) {
        setDragging(false);
        onCollapseFirst?.();
        return;
      }
      // Past min for the second pane — collapse it.
      if (raw > maxFirstRatio + buffer) {
        setDragging(false);
        onCollapseSecond?.();
        return;
      }
      // Otherwise clamp + persist.
      const next = Math.max(minFirstRatio, Math.min(maxFirstRatio, raw));
      setSplit(next);
      saveSplit(storageKey, next);
    };

    const handleUp = () => setDragging(false);

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = isVertical ? "row-resize" : "col-resize";

    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, isVertical, minFirstPx, minSecondPx, storageKey, onCollapseFirst, onCollapseSecond]);

  const onPointerDown = (e) => {
    setDragging(true);
    e.preventDefault();
  };

  // The handle is a 1.5px line with a hit-target that's negatively-
  // margined so users get a generous grab area without inflating
  // visual padding. Hover + drag states tint the handle accent.
  const handleBaseCls = isVertical
    ? "h-1.5 w-full cursor-row-resize -my-0.5"
    : "w-1.5 h-full cursor-col-resize -mx-0.5";
  const grip = (
    <div
      className={`rounded-full transition-opacity ${
        dragging ? "opacity-90" : "opacity-30 group-hover:opacity-70"
      } ${dark ? "bg-slate-400" : "bg-slate-500"} ${
        isVertical ? "w-10 h-0.5" : "h-10 w-0.5"
      }`}
    />
  );

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isVertical ? "flex-col" : "flex-row"}`}
    >
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${split} 1 0` }}>
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        aria-label={isVertical ? "Resize video / chat split" : "Resize chat / video split"}
        onPointerDown={onPointerDown}
        // touch-none so a touch-drag resizes instead of scrolling the page.
        className={`group shrink-0 flex items-center justify-center transition-colors touch-none ${handleBaseCls} ${
          dragging
            ? "bg-[var(--color-accent)]/30"
            : "hover:bg-[var(--color-accent)]/15"
        }`}
      >
        {grip}
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${1 - split} 1 0` }}>
        {second}
      </div>
    </div>
  );
}
