// Pen auto-shape recognition. PURE (no React / no I/O) so it's unit-testable.
// Given a freehand pen stroke's points, decide whether it's cleanly a
// rectangle / ellipse / triangle / diamond / straight-line, and return the
// geometry to snap to — or null to keep the stroke freehand.
//
// Points are [x, y] (or [x, y, pressure]) in WORLD coords. Deliberately
// heuristic + cheap: a whiteboard wants "close enough" snapping, not a trained
// recognizer.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

// Perpendicular distance from point p to the line through a→b.
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L === 0) return dist(p, a);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

// Ramer–Douglas–Peucker polyline simplification → the "corners".
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

// rawPts: [[x,y,(pressure)], ...]. Returns:
//   { kind: 'rect'|'ellipse'|'diamond'|'triangle', rect: {x,y,w,h} }
//   { kind: 'line', from: {x,y}, to: {x,y} }
//   null  (not confidently a shape — keep the freehand stroke)
export function recognizeStroke(rawPts) {
  if (!rawPts || rawPts.length < 8) return null;
  const pts = rawPts.map((p) => [p[0], p[1]]);
  const bb = bbox(pts);
  const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
  const diag = Math.hypot(w, h);
  if (diag < 24) return null; // too tiny to be intentional

  const start = pts[0], end = pts[pts.length - 1];
  const gap = dist(start, end);
  const len = pathLength(pts);
  // Closed = ends near the start AND the path actually went around (not a
  // back-and-forth scribble).
  const closed = gap < Math.max(diag * 0.28, 24) && len > diag * 1.5;

  if (!closed) {
    // Open stroke: a straight line if every point hugs the start→end chord.
    const straight = dist(start, end);
    if (straight < 24) return null;
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, perpDist(p, start, end));
    if (maxDev < Math.max(straight * 0.12, 10)) {
      return { kind: "line", from: { x: start[0], y: start[1] }, to: { x: end[0], y: end[1] } };
    }
    return null;
  }

  // Closed: simplify the loop to count corners.
  const loop = pts.concat([start]);
  const eps = Math.max(diag * 0.06, 6);
  let simp = rdp(loop, eps);
  // Drop the duplicate closing vertex.
  if (simp.length > 2 && dist(simp[0], simp[simp.length - 1]) < eps) simp = simp.slice(0, -1);
  const corners = simp.length;

  // Average normalized radial error against the bbox-inscribed ellipse.
  const cx = bb.minX + w / 2, cy = bb.minY + h / 2, rx = w / 2 || 1, ry = h / 2 || 1;
  let ellErr = 0;
  for (const p of pts) {
    const dx = (p[0] - cx) / rx, dy = (p[1] - cy) / ry;
    ellErr += Math.abs(Math.hypot(dx, dy) - 1);
  }
  ellErr /= pts.length;

  const rect = { x: bb.minX, y: bb.minY, w: Math.max(1, w), h: Math.max(1, h) };

  // Smooth loop → ellipse.
  if (corners <= 2 || ellErr < 0.12) return { kind: "ellipse", rect };
  if (corners === 3) return { kind: "triangle", rect };
  if (corners === 4) {
    // Rect (corners at the bbox corners) vs diamond (corners at edge midpoints).
    const nearBoxCorner = simp.filter((c) =>
      (Math.abs(c[0] - bb.minX) < w * 0.22 || Math.abs(c[0] - bb.maxX) < w * 0.22) &&
      (Math.abs(c[1] - bb.minY) < h * 0.22 || Math.abs(c[1] - bb.maxY) < h * 0.22),
    ).length;
    return nearBoxCorner >= 3 ? { kind: "rect", rect } : { kind: "diamond", rect };
  }
  // Many-cornered but round → ellipse; otherwise keep freehand.
  if (ellErr < 0.22) return { kind: "ellipse", rect };
  return null;
}

// Map a recognized closed-shape kind → the whiteboard `data.shape` key (nodes.jsx SHAPES).
export const SHAPE_KIND_TO_NODE = {
  rect: "process",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "triangle",
};
