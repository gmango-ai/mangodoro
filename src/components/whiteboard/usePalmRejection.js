import { useCallback, useRef } from "react";
import { PEN_GRACE_MS } from "./wbConstants";

// Apple-Pencil-first pointer classification + palm rejection for the whiteboard
// drawing tools (pen / brush / laser all read this). Extracted from
// WhiteboardPage.jsx so each tool's own state lives in its own hook and this
// shared "who is this pointer, and is the Pencil in charge?" logic lives here.
//
// `strokeTypeRef` is the drawing session's shared "type of the pointer that owns
// the active stroke" ref (owned by the component, since the pointer dispatcher +
// cancelActiveStroke also read/write it) — penActive reads it, so it's passed in.
//
// Returns the classification helpers plus the two refs the pointer dispatcher
// still stamps directly on a pen event (lastPenTsRef / stylusSeenRef).
export function usePalmRejection({ strokeTypeRef }) {
  // Native Apple Pencil detection via WebKit TouchEvents. PointerEvent's
  // `pointerType:"pen"` is unreliable inside the iOS WKWebView, but every touch
  // carries `Touch.touchType` ("stylus" | "direct") + `Touch.force` — the real
  // native pen API. We mirror the live touches here so a pointerdown (which
  // lacks touchType) can be classified by matching its position to a touch.
  const touchMapRef = useRef(new Map()); // identifier → { type, x, y, force }
  // Sticky: once a stylus has touched this board, adopt the Procreate model —
  // the Pencil draws, fingers pan/gesture (they never draw). This is what makes
  // palm rejection + two-finger-undo actually work.
  const stylusSeenRef = useRef(false);
  // Timestamp of the most recent stylus contact (grace window for marquee).
  const lastPenTsRef = useRef(0);

  const trackTouches = useCallback((e) => {
    const m = touchMapRef.current;
    m.clear();
    let stylus = false;
    for (const t of e.touches) {
      const type = t.touchType || "direct"; // non-WebKit → treat as finger
      const radius = Math.max(t.radiusX || 0, t.radiusY || 0);
      m.set(t.identifier, { type, x: t.clientX, y: t.clientY, force: t.force, radius });
      if (type === "stylus") stylus = true;
    }
    if (stylus) { stylusSeenRef.current = true; lastPenTsRef.current = Date.now(); }
  }, []);

  // Classify a pointer as pen/touch/mouse, preferring the WebKit stylus signal
  // (by nearest touch position) over the unreliable pointerType.
  const classifyPointer = useCallback((e) => {
    if (e.pointerType === "pen") return "pen";
    if (e.pointerType === "mouse") return "mouse";
    let best = null, bestD = Infinity;
    for (const t of touchMapRef.current.values()) {
      const d = Math.abs(t.x - e.clientX) + Math.abs(t.y - e.clientY);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && bestD <= 14) return best.type === "stylus" ? "pen" : "touch";
    return "touch";
  }, []);

  // Force (0..1) for the matching stylus touch, else the pointer's pressure.
  const pointerForce = useCallback((e) => {
    let best = null, bestD = Infinity;
    for (const t of touchMapRef.current.values()) {
      const d = Math.abs(t.x - e.clientX) + Math.abs(t.y - e.clientY);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && bestD <= 14 && best.force > 0) return best.force;
    return e.pressure > 0 ? e.pressure : 0.5;
  }, []);

  const penActive = useCallback(
    () => strokeTypeRef.current === "pen" || Date.now() - lastPenTsRef.current < PEN_GRACE_MS,
    [strokeTypeRef],
  );

  return { trackTouches, classifyPointer, pointerForce, penActive, lastPenTsRef, stylusSeenRef };
}
