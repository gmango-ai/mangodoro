import { useEffect, useMemo, useRef, useState } from "react";
import { solveLayout } from "./layoutSolver";

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const EASE = "cubic-bezier(.22,.61,.36,1)";

// Animated call stage. `tiles` = [{ key, content }]; `focusKey` marks the big
// tile (screen share / pin / featured speaker) or null for an even grid. Each
// tile is absolutely positioned at its solved rect (position via GPU transform,
// size via width/height) and CSS-transitions between layouts, so joins, leaves,
// screen-shares, resizes and speaker switches GLIDE instead of snapping. A tile
// stays mounted across layout changes (stable React key), so its <video> never
// re-attaches.
export default function AdaptiveStage({ tiles, focusKey = null, gap = 8, aspect = 16 / 9, durationMs = 320 }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const keys = tiles.map((t) => t.key);
  const keySig = keys.join("|");
  const rects = useMemo(
    () => solveLayout({ tiles: keys, focusKey, width: w, height: h, gap, aspect }),
    // keySig captures membership/order without re-running on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keySig, focusKey, w, h, gap, aspect],
  );

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {tiles.map((t) => {
        const r = rects.get(t.key);
        const placed = !!r && r.w > 0 && r.h > 0;
        return (
          <div
            key={t.key}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: placed ? r.w : 0,
              height: placed ? r.h : 0,
              transform: placed ? `translate(${r.x}px, ${r.y}px)` : "translate(0, 0)",
              opacity: placed ? 1 : 0,
              transition: `transform ${durationMs}ms ${EASE}, width ${durationMs}ms ${EASE}, height ${durationMs}ms ${EASE}, opacity 200ms ease`,
              willChange: "transform, width, height",
              pointerEvents: placed ? "auto" : "none",
            }}
          >
            {t.content}
          </div>
        );
      })}
    </div>
  );
}
