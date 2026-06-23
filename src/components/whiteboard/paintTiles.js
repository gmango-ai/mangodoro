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
  let prev = store.strokes.get(chunk.id) || null;
  for (const [x, y] of pts) {
    if (prev) segment(store, prev[0], prev[1], x, y, chunk.brush);
    else dab(store, x, y, chunk.brush);
    prev = [x, y];
  }
  if (chunk.end) store.strokes.delete(chunk.id);
  else if (prev) store.strokes.set(chunk.id, prev);
}
