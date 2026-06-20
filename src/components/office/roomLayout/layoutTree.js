// BSP layout tree for a room's panels.
//
//   leaf  → { t: "leaf", panel }                         a single panel
//   split → { t: "split", dir, a, b, ratio }             two children + divider
//
// dir "row" = side-by-side (a = left,  b = right),  split along x
// dir "col" = stacked      (a = top,   b = bottom), split along y
// ratio = fraction of the available space given to child `a` (0..1).
//
// Everything here is pure: the renderer turns a tree + a pixel rect into
// absolute tile/divider rects, and the state hook edits the tree
// immutably. Keeping geometry out of React is what lets us reposition
// panels without ever remounting them (so the video iframe never reloads).

export const GAP = 12;     // gutter between panes; the divider lives in it
export const MIN_PX = 160; // a pane never resizes below this

export function leaf(panel) { return { t: "leaf", panel }; }
export function split(dir, a, b, ratio = 0.5) { return { t: "split", dir, a, b, ratio }; }

// Every panel id referenced by the tree.
export function panelsIn(node, acc = []) {
  if (!node) return acc;
  if (node.t === "leaf") { acc.push(node.panel); return acc; }
  panelsIn(node.a, acc);
  panelsIn(node.b, acc);
  return acc;
}

// Place every leaf + divider in container-local coordinates. `path` is an
// array of "a"/"b" steps identifying each node (also used to edit it).
export function computeLayout(node, rect, gap = GAP) {
  const leaves = [];
  const dividers = [];
  function go(n, r, path) {
    if (!n) return;
    if (n.t === "leaf") { leaves.push({ panel: n.panel, rect: r, path }); return; }
    const horiz = n.dir === "row";
    const avail = (horiz ? r.w : r.h) - gap;
    const aSize = Math.max(0, avail * n.ratio);
    const bSize = Math.max(0, avail - aSize);
    if (horiz) {
      go(n.a, { x: r.x, y: r.y, w: aSize, h: r.h }, [...path, "a"]);
      go(n.b, { x: r.x + aSize + gap, y: r.y, w: bSize, h: r.h }, [...path, "b"]);
      dividers.push({ path, dir: n.dir, splitRect: r, rect: { x: r.x + aSize, y: r.y, w: gap, h: r.h } });
    } else {
      go(n.a, { x: r.x, y: r.y, w: r.w, h: aSize }, [...path, "a"]);
      go(n.b, { x: r.x, y: r.y + aSize + gap, w: r.w, h: bSize }, [...path, "b"]);
      dividers.push({ path, dir: n.dir, splitRect: r, rect: { x: r.x, y: r.y + aSize, w: r.w, h: gap } });
    }
  }
  go(node, rect, []);
  return { leaves, dividers };
}

// Immutably set the ratio of the split at `path`.
export function setRatioAt(node, path, ratio) {
  if (!path.length) return { ...node, ratio };
  const [head, ...rest] = path;
  return { ...node, [head]: setRatioAt(node[head], rest, ratio) };
}

// Drop the node at `path`, collapsing its parent split to the sibling.
// Returns the new root (or null if the root itself was removed).
export function removeAt(node, path) {
  if (!path.length) return null;
  if (path.length === 1) return node[path[0] === "a" ? "b" : "a"];
  const [head, ...rest] = path;
  return { ...node, [head]: removeAt(node[head], rest) };
}

// Keep only panels in `available`, collapsing splits that lose a child.
// Also de-dupes (a panel can appear at most once). Returns a valid tree
// or null if nothing survives.
export function sanitize(node, available, seen = new Set()) {
  if (!node) return null;
  if (node.t === "leaf") {
    if (!available.includes(node.panel) || seen.has(node.panel)) return null;
    seen.add(node.panel);
    return node;
  }
  const a = sanitize(node.a, available, seen);
  const b = sanitize(node.b, available, seen);
  if (a && b) return { ...node, a, b };
  return a || b || null;
}

// Path to the leaf holding `panel`, or null.
export function findPath(node, panel, path = []) {
  if (!node) return null;
  if (node.t === "leaf") return node.panel === panel ? path : null;
  return findPath(node.a, panel, [...path, "a"]) || findPath(node.b, panel, [...path, "b"]);
}

// Replace the leaf at `path` with a split that places `newPanel` on `side`
// of the existing leaf.
function splitWith(targetLeaf, newPanel, side) {
  const nl = leaf(newPanel);
  switch (side) {
    case "left": return split("row", nl, targetLeaf, 0.5);
    case "right": return split("row", targetLeaf, nl, 0.5);
    case "top": return split("col", nl, targetLeaf, 0.5);
    case "bottom": return split("col", targetLeaf, nl, 0.5);
    default: return targetLeaf;
  }
}
export function splitLeafAt(node, path, newPanel, side) {
  if (!path.length) return splitWith(node, newPanel, side);
  const [head, ...rest] = path;
  return { ...node, [head]: splitLeafAt(node[head], rest, newPanel, side) };
}

// Swap the panels held by two leaves (structure unchanged).
export function swapPanels(node, a, b) {
  if (!node) return node;
  if (node.t === "leaf") {
    if (node.panel === a) return { ...node, panel: b };
    if (node.panel === b) return { ...node, panel: a };
    return node;
  }
  return { ...node, a: swapPanels(node.a, a, b), b: swapPanels(node.b, a, b) };
}

// Add a panel not currently in the tree as a new right-hand column (the
// user can rearrange/resize after). No-op if it's already shown.
export function addPanelToTree(tree, panel) {
  if (!tree) return leaf(panel);
  if (findPath(tree, panel)) return tree;
  return split("row", tree, leaf(panel), 0.68);
}

// Add a hidden panel by splitting a specific target leaf on `side`
// ("left"/"right"/"top"/"bottom"). Falls back to a root column if the
// target can't be found. No-op if the panel is already shown.
export function addPanelAtTree(tree, panel, target, side) {
  if (!tree) return leaf(panel);
  if (findPath(tree, panel)) return tree;
  const tp = findPath(tree, target);
  if (!tp) return addPanelToTree(tree, panel);
  return splitLeafAt(tree, tp, panel, side);
}

// Move `dragged` relative to `target`: "center" swaps the two; an edge
// ("left"/"right"/"top"/"bottom") pulls the dragged leaf out of its spot
// (its sibling expands) and re-inserts it splitting the target on that side.
export function movePanelInTree(tree, dragged, target, zone) {
  if (!dragged || !target || dragged === target) return tree;
  if (zone === "center") return swapPanels(tree, dragged, target);
  const without = removeAt(tree, findPath(tree, dragged));
  if (!without) return tree;
  const tp = findPath(without, target);
  if (!tp) return tree;
  return splitLeafAt(without, tp, dragged, zone);
}
