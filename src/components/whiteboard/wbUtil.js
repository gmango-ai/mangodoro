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
