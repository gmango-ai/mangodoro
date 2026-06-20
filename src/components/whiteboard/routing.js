// ── Orthogonal obstacle-avoiding edge routing ───────────────────────
//
// A* over an "orthogonal visibility grid": candidate grid lines are taken
// from each obstacle's inflated borders plus the two stub endpoints. The
// router walks the channels BETWEEN nodes (never through them) and pays a
// penalty per bend, so it favours clean, mostly-straight paths — the same
// idea Lucidchart / draw.io use. Returns the interior corner points
// (excluding the source & target), or null when it can't find a path (the
// caller then falls back to the naive elbow route).

const STUB = 22;     // perpendicular exit distance from a node
const MARGIN = 16;   // clearance kept around every obstacle
const BEND = 18;     // extra cost per 90° turn (favours fewer bends)
const MAX_LINES = 90; // grid bail-out — keep routing snappy on huge boards

// Outward normal for an anchor side ("top"/"right"/"bottom"/"left").
export function sideNormal(pos) {
  return pos === "left" ? { x: -1, y: 0 }
    : pos === "right" ? { x: 1, y: 0 }
    : pos === "top" ? { x: 0, y: -1 }
    : { x: 0, y: 1 };
}

// Tiny binary min-heap keyed by priority.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(id, p) {
    const a = this.a; a.push({ id, p });
    let i = a.length - 1;
    while (i > 0) { const par = (i - 1) >> 1; if (a[par].p <= a[i].p) break; [a[par], a[i]] = [a[i], a[par]]; i = par; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top.id;
  }
}

function simplify(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// s,t: {x,y} anchor points. sDir,tDir: outward normals. obstacles: rects
// {x,y,w,h} (NOT including the source/target nodes).
export function routeAround(s, sDir, t, tDir, obstacles) {
  const s1 = { x: s.x + sDir.x * STUB, y: s.y + sDir.y * STUB };
  const t1 = { x: t.x + tDir.x * STUB, y: t.y + tDir.y * STUB };

  const xset = new Set([s1.x, t1.x]);
  const yset = new Set([s1.y, t1.y]);
  for (const o of obstacles) {
    xset.add(o.x - MARGIN); xset.add(o.x + o.w + MARGIN);
    yset.add(o.y - MARGIN); yset.add(o.y + o.h + MARGIN);
  }
  const X = [...xset].sort((a, b) => a - b);
  const Y = [...yset].sort((a, b) => a - b);
  const W = X.length, H = Y.length;
  if (W > MAX_LINES || H > MAX_LINES) return null;

  const xi = new Map(X.map((v, i) => [v, i]));
  const yi = new Map(Y.map((v, i) => [v, i]));
  const sIx = xi.get(s1.x), sIy = yi.get(s1.y), tIx = xi.get(t1.x), tIy = yi.get(t1.y);
  if (sIx == null || sIy == null || tIx == null || tIy == null) return null;

  const blockedPt = (px, py) => {
    for (const o of obstacles) {
      if (px > o.x - MARGIN + 0.5 && px < o.x + o.w + MARGIN - 0.5 &&
          py > o.y - MARGIN + 0.5 && py < o.y + o.h + MARGIN - 0.5) return true;
    }
    return false;
  };
  const segOpen = (x0, y0, x1, y1) => {
    const n = 6;
    for (let k = 0; k <= n; k++) {
      if (blockedPt(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return false;
    }
    return true;
  };

  const N = W * H;
  const id = (ix, iy) => iy * W + ix;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const dir = new Int8Array(N); // 0 none, 1 horiz, 2 vert
  const closed = new Uint8Array(N);
  const start = id(sIx, sIy), goal = id(tIx, tIy);
  g[start] = 0;
  const h = (ix, iy) => Math.abs(X[tIx] - X[ix]) + Math.abs(Y[tIy] - Y[iy]);
  const open = new Heap();
  open.push(start, h(sIx, sIy));

  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cix = cur % W, ciy = (cur / W) | 0;
    const steps = [[cix + 1, ciy], [cix - 1, ciy], [cix, ciy + 1], [cix, ciy - 1]];
    for (const [nix, niy] of steps) {
      if (nix < 0 || nix >= W || niy < 0 || niy >= H) continue;
      const nid = id(nix, niy);
      if (closed[nid]) continue;
      const x0 = X[cix], y0 = Y[ciy], x1 = X[nix], y1 = Y[niy];
      if (!segOpen(x0, y0, x1, y1)) continue;
      const moveDir = niy === ciy ? 1 : 2;
      const bend = dir[cur] && dir[cur] !== moveDir ? BEND : 0;
      const tentative = g[cur] + Math.abs(x1 - x0) + Math.abs(y1 - y0) + bend;
      if (tentative < g[nid]) {
        g[nid] = tentative;
        came[nid] = cur;
        dir[nid] = moveDir;
        open.push(nid, tentative + h(nix, niy));
      }
    }
  }
  if (goal !== start && came[goal] === -1) return null;

  const path = [];
  for (let c = goal; c !== -1; c = came[c]) path.push({ x: X[c % W], y: Y[(c / W) | 0] });
  path.reverse();
  return simplify([s, ...path, t]).slice(1, -1);
}
