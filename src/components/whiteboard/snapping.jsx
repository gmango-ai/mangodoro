import { useStore } from "@xyflow/react";

// Snapping for the whiteboard.
//
// Two layers, used together:
//  • Grid — every node drag, resize, and edge bend rounds to SNAP_GRID, so
//    things stay loosely tidy.
//  • Alignment guides — while dragging a single node it snaps to align with
//    nearby nodes' edges/centres (FigJam/Figma style) and we draw a guide
//    line. Computed in ABSOLUTE flow coords so it works for framed children.

export const SNAP_GRID = 8;          // flow units
const ALIGN_SCREEN_PX = 9;           // snap threshold, in *screen* px (÷ zoom below)

export function snapToGrid(v, grid = SNAP_GRID) {
  return Math.round(v / grid) * grid;
}

// Whether a node participates in snapping (grid + alignment). Sticky notes
// default OFF — they're free-form; everything else defaults ON. A per-item
// `data.snap` flag overrides either way (the Inspector's snap toggle).
export function nodeSnaps(node) {
  if (node?.data?.snap === true) return true;
  if (node?.data?.snap === false) return false;
  return node?.type !== "sticky";
}

// Find the closest edge/centre alignment on each axis between the dragged
// node's absolute rect and the others'. Returns the snapped absolute top-left
// (x/y null = no snap on that axis) plus the guide lines to draw.
export function getAlignmentGuides(drag, others, dist) {
  const dL = drag.x, dC = drag.x + drag.w / 2, dR = drag.x + drag.w;
  const dT = drag.y, dM = drag.y + drag.h / 2, dB = drag.y + drag.h;
  let snapX = null, snapY = null, bestX = dist, bestY = dist;
  let vertical = null, horizontal = null;

  for (const o of others) {
    const oXs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oYs = [o.y, o.y + o.h / 2, o.y + o.h];
    const oT = o.y, oB = o.y + o.h, oL = o.x, oR = o.x + o.w;

    // Vertical guides — align an X coordinate. `off` converts the matched
    // dragged edge back to the node's top-left.
    for (const [dv, off] of [[dL, 0], [dC, drag.w / 2], [dR, drag.w]]) {
      for (const ov of oXs) {
        const diff = Math.abs(dv - ov);
        if (diff < bestX) {
          bestX = diff;
          snapX = ov - off;
          vertical = { x: ov, y1: Math.min(dT, oT), y2: Math.max(dB, oB) };
        }
      }
    }
    // Horizontal guides — align a Y coordinate.
    for (const [dh, off] of [[dT, 0], [dM, drag.h / 2], [dB, drag.h]]) {
      for (const oh of oYs) {
        const diff = Math.abs(dh - oh);
        if (diff < bestY) {
          bestY = diff;
          snapY = oh - off;
          horizontal = { y: oh, x1: Math.min(dL, oL), x2: Math.max(dR, oR) };
        }
      }
    }
  }
  return { x: snapX, y: snapY, vertical, horizontal };
}

// Screen-space threshold → flow units at the current zoom (consistent feel).
export function alignDistance(zoom) {
  return ALIGN_SCREEN_PX / (zoom || 1);
}

// Guide lines drawn over the pane while dragging. Coords are flow units; we
// project to screen with the live viewport transform. Only mount while there
// are lines (it subscribes to viewport changes).
export function HelperLines({ vertical, horizontal }) {
  const tx = useStore((s) => s.transform[0]);
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]);
  if (!vertical && !horizontal) return null;
  const color = "#ec4899"; // FigJam-ish pink
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9 }}>
      {vertical && (
        <div style={{
          position: "absolute",
          left: vertical.x * zoom + tx,
          top: vertical.y1 * zoom + ty,
          width: 1,
          height: Math.max(0, (vertical.y2 - vertical.y1) * zoom),
          background: color,
        }} />
      )}
      {horizontal && (
        <div style={{
          position: "absolute",
          top: horizontal.y * zoom + ty,
          left: horizontal.x1 * zoom + tx,
          height: 1,
          width: Math.max(0, (horizontal.x2 - horizontal.x1) * zoom),
          background: color,
        }} />
      )}
    </div>
  );
}
