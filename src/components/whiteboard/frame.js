// Helpers for frame containers (xyflow parent/child grouping).

// Absolute flow position of a node, walking up its parent chain.
export function nodeAbsPos(node, byId) {
  let x = node.position.x, y = node.position.y, p = node.parentId;
  const seen = new Set();
  while (p && !seen.has(p)) {
    seen.add(p);
    const par = byId.get(p);
    if (!par) break;
    x += par.position.x; y += par.position.y;
    p = par.parentId;
  }
  return { x, y };
}

// xyflow requires a parent node to appear BEFORE its children in the array.
// Stable sort by parent-chain depth keeps that invariant.
export function sortParentsFirst(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n) => {
    let d = 0, p = n.parentId; const seen = new Set();
    while (p && !seen.has(p)) { seen.add(p); d++; p = byId.get(p)?.parentId; }
    return d;
  };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

// Which frame (if any) contains a point in absolute flow coords.
export function frameAt(point, nodes, byId, excludeId) {
  for (const n of nodes) {
    if (n.type !== "frame" || n.id === excludeId) continue;
    const fp = nodeAbsPos(n, byId);
    const fw = n.width || 280, fh = n.height || 360;
    if (point.x >= fp.x && point.x <= fp.x + fw && point.y >= fp.y && point.y <= fp.y + fh) {
      return { frame: n, fp };
    }
  }
  return null;
}
