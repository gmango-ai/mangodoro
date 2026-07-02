// Pure geometry for the call stage. Given the tile keys, an optional focus key,
// and the container size, it returns a target rectangle { x, y, w, h } per key.
// AdaptiveStage absolutely-positions each tile at its rect and CSS-transitions
// between them, so any change (join / leave / share / resize / speaker switch)
// glides instead of snapping — the thing that makes Meet/Zoom feel fluid.
//
// Three shapes:
//   • no focus       → an even, aspect-clamped grid (bestGrid).
//   • focus + others → CONTENT layout: the focus gets the major area, the rest a
//                      filmstrip, ORIENTED BY THE CONTAINER ASPECT (wide → focus
//                      left + column on the right; tall/square → focus on top +
//                      row below). Fixes "the screen share takes over the centre
//                      and shoves everyone into unviewable positions".
//   • focus alone    → the focus fills the stage.
//
// `focusKeys` (an array) generalizes this to TWO big tiles — e.g. a pinned room
// view + the live speaker (the "pin + spotlight" view). The pair shares the major
// area as an even grid; everyone else drops into the same filmstrip. A single
// focus still fills its area exactly (no aspect letterboxing), unchanged.

// Container aspect at/above which we go focus-left + a right-hand column.
const WIDE = 1.3;

// Largest uniform tile (at `aspect`) that fits `n` tiles in w×h; returns the
// column count that maximises tile area so cells are never ultra-wide/skinny.
export function bestGrid(n, w, h, aspect, gap) {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, tileW: 0, tileH: 0 };
  let best = { cols: 1, tileW: 0, tileH: 0, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let tw = cw, th = cw / aspect;
    if (th > ch) { th = ch; tw = ch * aspect; }
    const area = tw * th;
    if (area > best.area) best = { cols, tileW: tw, tileH: th, area };
  }
  return best;
}

// Place `keys` as a centered uniform grid within the box (ox, oy, w, h). The
// final (short) row is centered too, so a 5-up grid reads as 3+2 centered.
function layoutGrid(keys, ox, oy, w, h, gap, aspect, out) {
  const n = keys.length;
  if (n === 0) return;
  const { cols, tileW, tileH } = bestGrid(n, w, h, aspect, gap);
  if (tileW <= 0) return;
  const rows = Math.ceil(n / cols);
  const gridH = rows * tileH + (rows - 1) * gap;
  const startY = oy + (h - gridH) / 2;
  keys.forEach((key, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const rowW = inRow * tileW + (inRow - 1) * gap;
    const rowStartX = ox + (w - rowW) / 2;
    const col = i % cols;
    out.set(key, {
      x: rowStartX + col * (tileW + gap),
      y: startY + row * (tileH + gap),
      w: tileW,
      h: tileH,
    });
  });
}

// A filmstrip: `keys` packed along the strip, each aspect-clamped, shrunk to fit
// so they never overflow. (Phase 2 caps this and swaps the tail for an avatar
// overflow row.)
function layoutStrip(keys, ox, oy, w, h, gap, aspect, vertical, out) {
  const n = keys.length;
  if (n === 0) return;
  if (vertical) {
    const cellH = (h - gap * (n - 1)) / n;
    let tileH = Math.min(cellH, w / aspect);
    const tileW = Math.min(w, tileH * aspect);
    tileH = tileW / aspect;
    const totalH = n * tileH + (n - 1) * gap;
    const startY = oy + (h - totalH) / 2;
    keys.forEach((key, i) => {
      out.set(key, { x: ox + (w - tileW) / 2, y: startY + i * (tileH + gap), w: tileW, h: tileH });
    });
  } else {
    const cellW = (w - gap * (n - 1)) / n;
    let tileW = Math.min(cellW, h * aspect);
    const tileH = Math.min(h, tileW / aspect);
    tileW = tileH * aspect;
    const totalW = n * tileW + (n - 1) * gap;
    const startX = ox + (w - totalW) / 2;
    keys.forEach((key, i) => {
      out.set(key, { x: startX + i * (tileW + gap), y: oy + (h - tileH) / 2, w: tileW, h: tileH });
    });
  }
}

export function solveLayout({ tiles, focusKey, focusKeys, width, height, gap = 8, aspect = 16 / 9 }) {
  const out = new Map();
  const keys = tiles || [];
  if (!width || !height || keys.length === 0) return out;

  // Normalize focus into a list (supports one OR two big tiles), keeping only
  // keys actually present so a stale pin/speaker can't leave a phantom slot.
  const foci = (focusKeys && focusKeys.length ? focusKeys : focusKey ? [focusKey] : [])
    .filter((k) => keys.includes(k));

  if (foci.length === 0) {
    layoutGrid(keys, 0, 0, width, height, gap, aspect, out);
    return out;
  }

  // Fill a box with the focus tile(s): a single focus fills it exactly (content
  // object-fits, no letterbox bars); two+ share it as an even aspect grid.
  const placeFoci = (ox, oy, w, h) => {
    if (foci.length === 1) out.set(foci[0], { x: ox, y: oy, w, h });
    else layoutGrid(foci, ox, oy, w, h, gap, aspect, out);
  };

  const others = keys.filter((k) => !foci.includes(k));
  if (others.length === 0) {
    placeFoci(0, 0, width, height);
    return out;
  }

  const ar = width / height;
  if (ar >= WIDE) {
    // Focus area left, vertical filmstrip on the right.
    const stripW = Math.round(Math.min(Math.max(width * 0.2, 150), 280));
    const focusW = width - stripW - gap;
    placeFoci(0, 0, focusW, height);
    layoutStrip(others, focusW + gap, 0, stripW, height, gap, aspect, true, out);
  } else {
    // Focus area on top, horizontal strip below (covers tall + square-ish).
    const stripH = Math.round(Math.min(Math.max(height * 0.22, 96), 168));
    const focusH = height - stripH - gap;
    placeFoci(0, 0, width, focusH);
    layoutStrip(others, 0, focusH + gap, width, stripH, gap, aspect, false, out);
  }
  return out;
}
