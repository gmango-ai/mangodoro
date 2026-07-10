// Pure, dependency-free helpers shared across the whiteboard editor. Extracted
// from WhiteboardPage.jsx so the page file stays focused on orchestration.

// ── Touch geometry ────────────────────────────────────────────────────────
export function touchCentroid(touches) {
  let x = 0, y = 0;
  const n = touches.length || 1;
  for (const t of touches) { x += t.clientX; y += t.clientY; }
  return { x: x / n, y: y / n };
}
export function touchSpread(touches, c) {
  if (touches.length < 2) return 0;
  let s = 0;
  for (const t of touches) s += Math.hypot(t.clientX - c.x, t.clientY - c.y);
  return s / touches.length;
}

// Ray-casting point-in-polygon (poly = [{x,y},...]). Used by the lasso to test
// which node centres it encloses.
export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A screen-space point path → an SVG polyline path string.
export function screenPolyPath(pts) {
  if (!pts || pts.length < 2) return "";
  return "M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L");
}

// ── Selection "envelope" geometry ─────────────────────────────────────────
// Andrew's monotone-chain convex hull. pts = [[x,y],...] → hull vertices CCW.
// Used to wrap a box selection's picked items in a contour (like a lasso).
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Push each hull vertex `pad` px outward from the centroid, so the contour sits
// a margin OUTSIDE the items it wraps.
export function padHull(hull, pad) {
  if (hull.length < 3) return hull;
  let cx = 0, cy = 0;
  for (const [x, y] of hull) { cx += x; cy += y; }
  cx /= hull.length; cy /= hull.length;
  return hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * pad, y + (dy / d) * pad];
  });
}

// A single rounded-rect SVG subpath. Selections union one of these per drawn
// item, so the envelope hugs content and skips the blank space between items.
export function roundedRectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x + rr} Q${x},${y + h} ${x},${y + h - rr} V${y + rr} Q${x},${y} ${x + rr},${y} Z`;
}

// Closed SVG path for a polygon with rounded corners (radius r). Works for both
// a few-vertex hull (visible rounding) and a many-point freehand loop (segments
// too short to round → effectively a smooth polyline).
export function roundedPolyPath(pts, r) {
  const n = pts.length;
  if (n < 3) return screenPolyPath(pts);
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const v1x = cur[0] - prev[0], v1y = cur[1] - prev[1];
    const v2x = next[0] - cur[0], v2y = next[1] - cur[1];
    const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cur[0] - (v1x / l1) * rr, ay = cur[1] - (v1y / l1) * rr;
    const bx = cur[0] + (v2x / l2) * rr, by = cur[1] + (v2y / l2) * rr;
    d += (i === 0 ? `M${ax},${ay}` : ` L${ax},${ay}`) + ` Q${cur[0]},${cur[1]} ${bx},${by}`;
  }
  return d + " Z";
}

// ── Ids + clone helpers ───────────────────────────────────────────────────
let _idSeq = 1;
export function freshId(prefix) {
  // 36ms time + counter is plenty to avoid id collisions inside one
  // tab without dragging in a uuid dep just for this.
  return `${prefix}-${Date.now().toString(36)}-${_idSeq++}`;
}

// Shared by cloneNodes / alt-drag clone: expand the picked ids to any framed
// children, drop zones, and mint fresh ids for the copies.
export function collectCloneSources(all, ids) {
  const set = new Set(ids);
  for (const n of all) if (n.parentId && set.has(n.parentId)) set.add(n.id); // frame children ride along
  const src = all.filter((n) => set.has(n.id) && n.type !== "zone");
  const idMap = new Map(src.map((n) => [n.id, freshId(n.type || "dup")]));
  return { src, idMap };
}

// Duplicate the edges fully inside a cloned selection onto the fresh ids.
export function duplicateInternalEdges(eds, idMap) {
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
