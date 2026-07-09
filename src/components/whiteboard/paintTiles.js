// Infinite tiled raster paint engine.
//
// The board is infinite, so the paint layer is a sparse grid of fixed-size
// bitmap TILES, materialised only where someone paints. Flow space is carved
// into TILE_UNITS-wide squares; each tile is a TILE_PX bitmap (PX_PER_UNIT
// pixels per flow unit). A brush stroke is rasterised onto whichever tiles it
// crosses — drawing in flow coordinates and letting each tile canvas clip what
// falls outside it, so we never need exact tile/stroke intersection tests.
//
// Sync is by STROKE VECTORS, not pixels: the page broadcasts a stroke's points
// + brush params, and every client runs this same rasteriser, so the bitmap
// result is identical everywhere while the wire stays tiny.

export const TILE_UNITS = 512;   // tile size in flow units
export const PX_PER_UNIT = 2;    // bitmap resolution (2 = crisp at up to ~2x zoom)
export const TILE_PX = TILE_UNITS * PX_PER_UNIT;

const tileKey = (tx, ty) => `${tx}_${ty}`;

// A store holds the live tiles + per-stroke cursors. onCreate fires when a new
// tile is materialised so the React layer can mount its canvas.
export function createPaintStore(onCreate) {
  return { tiles: new Map(), strokes: new Map(), onCreate };
}

// Materialise a tile without drawing (used when loading a persisted PNG in).
export function ensureTile(store, tx, ty) {
  return getOrCreateTile(store, tx, ty);
}

function getOrCreateTile(store, tx, ty) {
  const key = tileKey(tx, ty);
  let tile = store.tiles.get(key);
  if (tile) return tile;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  tile = { key, tx, ty, canvas, ctx, dirty: false };
  store.tiles.set(key, tile);
  store.onCreate?.(tile);
  return tile;
}

// Set up a tile context to draw in FLOW coordinates (scaled into the tile's
// local pixel space) with the given brush.
function paintInto(ctx, ox, oy, brush) {
  ctx.setTransform(PX_PER_UNIT, 0, 0, PX_PER_UNIT, -ox * PX_PER_UNIT, -oy * PX_PER_UNIT);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brush.size;
  ctx.strokeStyle = brush.color;
  ctx.fillStyle = brush.color;
  ctx.globalAlpha = brush.opacity ?? 1;
  ctx.globalCompositeOperation = brush.mode === "eraser" ? "destination-out" : "source-over";
}

function tileRange(minX, minY, maxX, maxY) {
  return {
    t0x: Math.floor(minX / TILE_UNITS), t1x: Math.floor(maxX / TILE_UNITS),
    t0y: Math.floor(minY / TILE_UNITS), t1y: Math.floor(maxY / TILE_UNITS),
  };
}

// Keys of every tile a segment a→b of the given brush size can touch (its bbox
// padded by the radius). Used by the undo layer to snapshot the right tiles
// before a stroke paints them. `size` is padded generously so textured brushes
// that spray slightly past the nib are fully covered.
// Keys of every tile a flow-space rect overlaps — for snapshotting a region
// before a select/move/delete.
export function regionTileKeys({ x, y, w, h }) {
  const keys = [];
  const t0x = Math.floor(x / TILE_UNITS), t1x = Math.floor((x + w) / TILE_UNITS);
  const t0y = Math.floor(y / TILE_UNITS), t1y = Math.floor((y + h) / TILE_UNITS);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) keys.push(tileKey(tx, ty));
  return keys;
}

export function segmentTileKeys(ax, ay, bx, by, size, set = new Set()) {
  const r = size * 0.75;
  const { t0x, t1x, t0y, t1y } = tileRange(
    Math.min(ax, bx) - r, Math.min(ay, by) - r,
    Math.max(ax, bx) + r, Math.max(ay, by) + r,
  );
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) set.add(tileKey(tx, ty));
  return set;
}

// ── Deterministic randomness for textured brushes ──────────────────────────
// Textured brushes (pencil grain, airbrush spray) place dots at pseudo-random
// spots. Sync broadcasts stroke VECTORS, not pixels, so every client must draw
// the SAME dots — seed a PRNG from the stroke id + point index (both on the
// wire) and local + remote agree pixel-for-pixel.
function hashSeed(id, i) {
  let h = (2166136261 ^ i) >>> 0;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stamp one filled dot of radius r at (x,y) across every tile it touches, at
// brush opacity × alpha. The building block for the textured brushes.
function stampDot(store, x, y, r, brush, alpha) {
  const { t0x, t1x, t0y, t1y } = tileRange(x - r, y - r, x + r, y + r);
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const tile = getOrCreateTile(store, tx, ty);
      paintInto(tile.ctx, tx * TILE_UNITS, ty * TILE_UNITS, brush);
      tile.ctx.globalAlpha = (brush.opacity ?? 1) * alpha;
      tile.ctx.beginPath();
      tile.ctx.arc(x, y, r, 0, Math.PI * 2);
      tile.ctx.fill();
      tile.dirty = true;
    }
  }
}

// "#rrggbb" → "rgba(r,g,b,0)" for a transparent radial-gradient edge stop.
function transparentEdge(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "rgba(0,0,0,0)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

// One soft round dab — opaque core feathering to a transparent edge (radial
// gradient). The airbrush building block; deterministic (no randomness).
function softDab(store, x, y, r, brush, alpha) {
  if (r <= 0) return;
  const { t0x, t1x, t0y, t1y } = tileRange(x - r, y - r, x + r, y + r);
  const edge = transparentEdge(brush.color);
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const tile = getOrCreateTile(store, tx, ty);
      const ctx = tile.ctx;
      paintInto(ctx, tx * TILE_UNITS, ty * TILE_UNITS, brush);
      ctx.globalAlpha = (brush.opacity ?? 1) * alpha;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, brush.color);
      g.addColorStop(0.35, brush.color);
      g.addColorStop(1, edge);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      tile.dirty = true;
    }
  }
}

// Airbrush: dense soft dabs along the segment at low alpha — a feathered,
// build-up spray with a soft edge (not a grainy texture). Deterministic.
function airbrushSegment(store, ax, ay, bx, by, brush) {
  const R = brush.size / 2;
  const dist = Math.hypot(bx - ax, by - ay);
  const spacing = Math.max(0.5, R * 0.3);
  const n = Math.max(1, Math.round(dist / spacing));
  for (let s = 0; s <= n; s++) {
    const t = n ? s / n : 0;
    softDab(store, ax + (bx - ax) * t, ay + (by - ay) * t, R, brush, 0.08);
  }
}

// Pencil: a graphite line — dense fine grains across the nib, centre-weighted
// with random gaps (the "tooth" of the paper) and per-grain alpha variation.
function pencilSegment(store, ax, ay, bx, by, brush, rng) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const step = Math.max(0.4, brush.size * 0.05); // tight spacing → continuous line
  const n = Math.max(1, Math.round(len / step));
  const nx = -dy / len, ny = dx / len; // unit normal
  const half = brush.size / 2;
  const grainR = Math.max(0.4, brush.size * 0.06);
  const grains = Math.max(4, Math.round(brush.size * 0.7));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const cx = ax + dx * t, cy = ay + dy * t;
    for (let g = 0; g < grains; g++) {
      if (rng() < 0.12) continue; // light paper tooth — a few gaps, not a dotted line
      const u = rng() + rng() - 1; // centre-weighted across the nib (~triangular)
      const off = u * half;
      stampDot(store, cx + nx * off, cy + ny * off, grainR, brush, 0.22 + rng() * 0.45);
    }
  }
}

// Draw a single round dab (stroke start / a tap).
function dab(store, x, y, brush) {
  const r = brush.size / 2;
  const { t0x, t1x, t0y, t1y } = tileRange(x - r, y - r, x + r, y + r);
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const tile = getOrCreateTile(store, tx, ty);
      paintInto(tile.ctx, tx * TILE_UNITS, ty * TILE_UNITS, brush);
      tile.ctx.beginPath();
      tile.ctx.arc(x, y, r, 0, Math.PI * 2);
      tile.ctx.fill();
      tile.dirty = true;
    }
  }
}

// Draw a stroke segment a→b onto every tile it can touch.
function segment(store, ax, ay, bx, by, brush) {
  const r = brush.size / 2;
  const { t0x, t1x, t0y, t1y } = tileRange(
    Math.min(ax, bx) - r, Math.min(ay, by) - r,
    Math.max(ax, bx) + r, Math.max(ay, by) + r,
  );
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const tile = getOrCreateTile(store, tx, ty);
      paintInto(tile.ctx, tx * TILE_UNITS, ty * TILE_UNITS, brush);
      tile.ctx.beginPath();
      tile.ctx.moveTo(ax, ay);
      tile.ctx.lineTo(bx, by);
      tile.ctx.stroke();
      tile.dirty = true;
    }
  }
}

// Rasterise a stroke chunk: { id, brush, pts:[[x,y]...], end? }. Connects to the
// stroke's previous point (tracked by id) so streamed chunks join seamlessly.
// Local and remote strokes both flow through here for identical results.
export function applyPaintChunk(store, chunk) {
  if (!chunk || !chunk.brush) return;
  const pts = chunk.pts || [];
  const brush = chunk.brush;
  // Erasing is always a clean round stroke; texture only applies to painting.
  const texture = brush.mode === "eraser" ? "smooth" : (brush.texture || "smooth");
  const st = store.strokes.get(chunk.id) || { prev: null, i: 0 };
  let prev = st.prev;
  let i = st.i;
  for (const [x, y] of pts) {
    if (texture === "airbrush") {
      airbrushSegment(store, prev ? prev[0] : x, prev ? prev[1] : y, x, y, brush);
    } else if (texture === "pencil") {
      const rng = mulberry32(hashSeed(chunk.id, i)); // deterministic per point
      pencilSegment(store, prev ? prev[0] : x, prev ? prev[1] : y, x, y, brush, rng);
    } else {
      if (prev) segment(store, prev[0], prev[1], x, y, brush);
      else dab(store, x, y, brush);
    }
    prev = [x, y];
    i++;
  }
  if (chunk.end) store.strokes.delete(chunk.id);
  else store.strokes.set(chunk.id, { prev, i });
}
