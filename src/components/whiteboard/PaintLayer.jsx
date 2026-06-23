import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import { createPaintStore, applyPaintChunk, ensureTile, TILE_UNITS, TILE_PX } from "./paintTiles";
import { listPaintTiles, uploadPaintTile } from "../../lib/whiteboardPaint";

const FLUSH_DELAY_MS = 2000; // idle time before dirty tiles are saved to Storage

// Renders the tiled raster paint layer inside the flow viewport. Each live tile
// is a persistent <canvas> (held by the store) that this component adopts into
// a positioned wrapper — so panning/zooming is free (the viewport transform
// scales it) and the pixels survive a tile scrolling in and out of the tree.
//
// Drawing is imperative: the page (and incoming peer strokes) call apply(chunk)
// via the ref; new tiles bump a counter so their canvas mounts. Locally-drawn
// tiles are flushed to Storage on an idle debounce; on open the board's tiles
// are listed and drawn back in. Pointer-events are off so the layer never
// blocks the canvas underneath.
function TileView({ tile }) {
  return (
    <div
      style={{
        position: "absolute",
        left: tile.tx * TILE_UNITS,
        top: tile.ty * TILE_UNITS,
        width: TILE_UNITS,
        height: TILE_UNITS,
        pointerEvents: "none",
      }}
      ref={(el) => { if (el && tile.canvas.parentNode !== el) el.appendChild(tile.canvas); }}
    />
  );
}

const PaintLayer = forwardRef(function PaintLayer({ boardId, enabled, zIndex = 5 }, ref) {
  const [, force] = useState(0);
  const bump = useCallback(() => force((n) => (n + 1) & 0xffff), []);
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createPaintStore(bump);

  const boardRef = useRef(boardId);
  boardRef.current = boardId;
  const flushTimer = useRef(0);

  // Save every dirty tile as a PNG (debounced). Idempotent upsert — last write
  // wins, and since every client renders identical pixels they converge.
  const doFlush = useCallback(() => {
    flushTimer.current = 0;
    const bId = boardRef.current;
    if (!bId) return;
    for (const tile of storeRef.current.tiles.values()) {
      if (!tile.dirty) continue;
      tile.dirty = false;
      // toBlob throws on a tainted canvas — guard so one bad tile can't abort
      // the whole flush (crossOrigin loads should keep it untainted anyway).
      try {
        tile.canvas.toBlob((blob) => { if (blob) uploadPaintTile(bId, tile.key, blob); }, "image/png");
      } catch { /* */ }
    }
  }, []);
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(doFlush, FLUSH_DELAY_MS);
  }, [doFlush]);

  useImperativeHandle(ref, () => ({
    // `local` strokes are mine → schedule a save; remote strokes are persisted
    // by their own author, so they only need rasterising.
    apply: (chunk, local) => {
      applyPaintChunk(storeRef.current, chunk);
      if (local) scheduleFlush();
    },
    store: storeRef.current,
  }), [scheduleFlush]);

  // Flush any pending save on unmount.
  useEffect(() => () => { if (flushTimer.current) { clearTimeout(flushTimer.current); doFlush(); } }, [doFlush]);

  // Load persisted tiles for this board on open. Skip a tile that's been
  // painted locally since (don't clobber fresh edits). crossOrigin keeps the
  // canvas untainted so toBlob() can still re-save it.
  useEffect(() => {
    if (!enabled || !boardId) return undefined;
    let cancelled = false;
    listPaintTiles(boardId).then((tiles) => {
      if (cancelled) return;
      for (const t of tiles) {
        const existing = storeRef.current.tiles.get(t.key);
        if (existing && existing.dirty) continue;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (cancelled) return;
          const ex2 = storeRef.current.tiles.get(t.key);
          if (ex2 && ex2.dirty) return;
          const tile = ensureTile(storeRef.current, t.tx, t.ty);
          const ctx = tile.ctx;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          ctx.clearRect(0, 0, TILE_PX, TILE_PX);
          ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX);
          bump();
        };
        img.src = t.url;
      }
    });
    return () => { cancelled = true; };
  }, [enabled, boardId, bump]);

  const tiles = [...storeRef.current.tiles.values()];
  return (
    <ViewportPortal>
      <div style={{ position: "absolute", left: 0, top: 0, zIndex }}>
        {tiles.map((tile) => <TileView key={tile.key} tile={tile} />)}
      </div>
    </ViewportPortal>
  );
});

export default PaintLayer;
