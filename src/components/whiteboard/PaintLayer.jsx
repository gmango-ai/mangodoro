import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import { createPaintStore, applyPaintChunk, TILE_UNITS } from "./paintTiles";

// Renders the tiled raster paint layer inside the flow viewport. Each live tile
// is a persistent <canvas> (held by the store) that this component adopts into
// a positioned wrapper — so panning/zooming is free (the viewport transform
// scales it) and the pixels survive a tile scrolling in and out of the tree.
//
// Drawing is imperative: the page (and incoming peer strokes) call apply(chunk)
// via the ref; new tiles bump a counter so their canvas mounts. Pointer-events
// are off so the layer never blocks the canvas underneath.
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

const PaintLayer = forwardRef(function PaintLayer({ zIndex = 5 }, ref) {
  const [, force] = useState(0);
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createPaintStore(() => force((n) => (n + 1) & 0xffff));
  }

  useImperativeHandle(ref, () => ({
    apply: (chunk) => applyPaintChunk(storeRef.current, chunk),
    store: storeRef.current,
  }), []);

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
