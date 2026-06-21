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
export const MIN_PX = 220; // a pane never resizes below this — keeps the
                           // video grid + control bar usable at any size

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

// ── Hide/show position memory ────────────────────────────────
// Toggling a panel off then on should put it back where it was. We capture
// its spot on remove (placementOf) and rebuild it on re-add (restorePlacement);
// if the spot is gone the caller falls back to a default side.

// The node at `path` (array of "a"/"b"), or null.
export function nodeAtPath(node, path) {
  let n = node;
  for (const step of path) {
    if (!n || n.t !== "split") return null;
    n = n[step];
  }
  return n;
}

// Path to the first node (leaf or split) satisfying `pred`, pre-order.
export function findNodePath(node, pred, path = []) {
  if (!node) return null;
  if (pred(node)) return path;
  if (node.t !== "split") return null;
  return findNodePath(node.a, pred, [...path, "a"]) || findNodePath(node.b, pred, [...path, "b"]);
}

// Immutably replace the node at `path` with `next`.
export function replaceAtPath(node, path, next) {
  if (!path.length) return next;
  const [head, ...rest] = path;
  return { ...node, [head]: replaceAtPath(node[head], rest, next) };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  for (const x of a) if (!s.has(x)) return false;
  return true;
}

// Capture where `panel` sits: which side of its parent split it was on, the
// split direction + ratio, and the panel ids in its sibling subtree (used to
// re-find that sibling on restore). Null if it's the lone root panel.
export function placementOf(tree, panel) {
  const path = findPath(tree, panel);
  if (!path || path.length === 0) return null;
  const side = path[path.length - 1];
  const parent = nodeAtPath(tree, path.slice(0, -1));
  if (!parent || parent.t !== "split") return null;
  const sibling = parent[side === "a" ? "b" : "a"];
  return { side, dir: parent.dir, ratio: parent.ratio, siblingPanels: panelsIn(sibling) };
}

// Re-insert `panel` at a remembered `placement` by wrapping its old sibling
// subtree back in the same split. Returns the new tree, or null if the
// sibling no longer exists (caller then uses a default side).
export function restorePlacement(tree, panel, placement) {
  if (!tree || !placement || findPath(tree, panel)) return null;
  const path = findNodePath(tree, (n) => sameSet(panelsIn(n), placement.siblingPanels));
  if (!path) return null;
  const sib = nodeAtPath(tree, path);
  const nl = leaf(panel);
  const wrapped = placement.side === "a"
    ? split(placement.dir, nl, sib, placement.ratio)
    : split(placement.dir, sib, nl, placement.ratio);
  return replaceAtPath(tree, path, wrapped);
}
