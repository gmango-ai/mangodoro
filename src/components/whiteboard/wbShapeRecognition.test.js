import { describe, it, expect } from "vitest";
import { recognizeStroke, SHAPE_KIND_TO_NODE } from "./wbShapeRecognition";

// Helpers to synthesize freehand-ish strokes (with a little jitter so the
// recognizer's tolerances actually get exercised, not a perfect polyline).
const jitter = (i) => ((i * 2654435761) % 7) - 3; // deterministic ±3px

function lerpPts(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t + jitter(i), a[1] + (b[1] - a[1]) * t + jitter(i + 1)]);
  }
  return out;
}

function polygon(corners, perSide) {
  const pts = [];
  for (let s = 0; s < corners.length; s++) {
    const a = corners[s], b = corners[(s + 1) % corners.length];
    pts.push(...lerpPts(a, b, perSide).slice(0, -1));
  }
  pts.push([...corners[0]]); // close it
  return pts;
}

describe("recognizeStroke", () => {
  it("returns null for too-few or tiny strokes", () => {
    expect(recognizeStroke(null)).toBeNull();
    expect(recognizeStroke([[0, 0], [1, 1]])).toBeNull();
    // 8 points but all within a few px → below the diag threshold.
    expect(recognizeStroke(Array.from({ length: 10 }, (_, i) => [i % 3, i % 2]))).toBeNull();
  });

  it("recognizes a rough square as a rect", () => {
    const s = polygon([[0, 0], [200, 0], [200, 200], [0, 200]], 12);
    const r = recognizeStroke(s);
    expect(r?.kind).toBe("rect");
    expect(r.rect.w).toBeGreaterThan(180);
    expect(r.rect.h).toBeGreaterThan(180);
  });

  it("recognizes a wide rectangle as a rect", () => {
    const s = polygon([[0, 0], [300, 0], [300, 100], [0, 100]], 14);
    expect(recognizeStroke(s)?.kind).toBe("rect");
  });

  it("recognizes a triangle", () => {
    const s = polygon([[100, 0], [200, 180], [0, 180]], 16);
    expect(recognizeStroke(s)?.kind).toBe("triangle");
  });

  it("recognizes a diamond (corners at edge midpoints)", () => {
    const s = polygon([[100, 0], [200, 100], [100, 200], [0, 100]], 16);
    expect(recognizeStroke(s)?.kind).toBe("diamond");
  });

  it("recognizes a slanted parallelogram as a rect (no parallelogram shape)", () => {
    // Right-slanted: top edge shifted +60 from the bottom edge.
    const s = polygon([[60, 0], [260, 0], [200, 120], [0, 120]], 14);
    expect(recognizeStroke(s)?.kind).toBe("rect");
  });

  it("does NOT read a wide flat quad as an ellipse", () => {
    const s = polygon([[40, 0], [240, 0], [200, 70], [0, 70]], 14);
    expect(recognizeStroke(s)?.kind).not.toBe("ellipse");
  });

  it("recognizes a circle as an ellipse", () => {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([100 + Math.cos(a) * 90 + jitter(i), 100 + Math.sin(a) * 90 + jitter(i + 1)]);
    }
    expect(recognizeStroke(pts)?.kind).toBe("ellipse");
  });

  it("recognizes a straight-ish open stroke as a line", () => {
    const s = lerpPts([0, 0], [300, 40], 24);
    const r = recognizeStroke(s);
    expect(r?.kind).toBe("line");
    expect(r.from.x).toBeLessThan(20);
    expect(r.to.x).toBeGreaterThan(280);
  });

  it("keeps a wandering open scribble freehand (null)", () => {
    // An 'S'-ish open path — not straight, not closed.
    const s = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      s.push([t * 200, Math.sin(t * Math.PI * 2) * 80 + 100]);
    }
    expect(recognizeStroke(s)).toBeNull();
  });

  it("maps every closed kind to a node shape key", () => {
    for (const k of ["rect", "ellipse", "diamond", "triangle"]) {
      expect(SHAPE_KIND_TO_NODE[k]).toBeTruthy();
    }
  });
});
