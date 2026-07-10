// Per-device / per-board localStorage for the whiteboard: the in-app clipboard,
// remembered viewport, and the tool style presets (text / pen / brush / laser).
// Extracted from WhiteboardPage.jsx. Pure I/O over localStorage — no React.

// In-app clipboard for copy / cut / paste. localStorage so it survives
// navigation between boards and works across tabs. Holds CLEANED nodes/edges
// keeping their ORIGINAL ids, so paste can remap them — preserving internal
// edges and frame parenting. (Not the OS clipboard — staying in-app avoids
// permission prompts and serialization quirks.)
const WB_CLIPBOARD_KEY = "ql_wb_clipboard";
export function readWbClipboard() {
  try {
    const raw = localStorage.getItem(WB_CLIPBOARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function writeWbClipboard(payload) {
  try {
    localStorage.setItem(WB_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch {
    /* storage disabled / quota — clipboard just no-ops */
  }
}

// Remember each board's pan/zoom so reopening it lands you where you left off
// (full-page boards only — embedded room boards still fit-to-view each time).
export function loadViewport(boardId) {
  if (!boardId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(`ql_wb_viewport:${boardId}`) || "null");
    if (v && typeof v.x === "number" && typeof v.y === "number" && typeof v.zoom === "number") return v;
  } catch { /* */ }
  return null;
}
export function saveViewport(boardId, vp) {
  if (!boardId || !vp) return;
  try {
    localStorage.setItem(`ql_wb_viewport:${boardId}`, JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom }));
  } catch { /* */ }
}

// Default style (font / size / colour / align) seeded into every new text node,
// remembered per device — like the sticky tool remembers its colour.
const TEXT_STYLE_KEY = "ql_wb_text_style";
export function loadTextStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(TEXT_STYLE_KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
export function saveTextStyle(style) {
  try { localStorage.setItem(TEXT_STYLE_KEY, JSON.stringify(style || {})); } catch { /* */ }
}

// Remembered pen colour + width for the freehand tool (per device).
const PEN_STYLE_KEY = "ql_wb_pen_style";
export const PEN_COLORS = [
  "#0f172a", "#475569", "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#ffffff",
];
export const PEN_WIDTHS = [["Fine", 2], ["Medium", 4], ["Bold", 8]];
export function loadPenStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(PEN_STYLE_KEY) || "null");
    if (v && typeof v.color === "string") {
      return { color: v.color, width: v.width || 4, opacity: v.opacity ?? 1, pressure: v.pressure ?? true };
    }
  } catch { /* */ }
  // Default to a mid blue that's visible on BOTH light and dark boards — the old
  // near-black (#0f172a) was invisible on the dark theme, so the pen looked
  // broken. Users can still pick black in the pen colour flyout.
  return { color: "#0ea5e9", width: 4, opacity: 1, pressure: true };
}
export function savePenStyle(style) {
  try { localStorage.setItem(PEN_STYLE_KEY, JSON.stringify(style)); } catch { /* */ }
}

// Remembered raster-brush settings. Brush and eraser keep INDEPENDENT sizes
// (size vs eraseSize) so switching between them doesn't clobber the other.
const BRUSH_STYLE_KEY = "ql_wb_brush_style";
export const BRUSH_TEXTURES = [["Smooth", "smooth"], ["Pencil", "pencil"], ["Airbrush", "airbrush"]];
export const BRUSH_SIZE_PRESETS = [["S", 6], ["M", 18], ["L", 42], ["XL", 90]];
export function loadBrushStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(BRUSH_STYLE_KEY) || "null");
    if (v && typeof v.color === "string") {
      return {
        color: v.color,
        size: v.size || 18,
        eraseSize: v.eraseSize || v.size || 32,
        opacity: v.opacity ?? 1,
        texture: v.texture || "smooth",
        erase: false,
      };
    }
  } catch { /* */ }
  return { color: "#0ea5e9", size: 18, eraseSize: 32, opacity: 1, texture: "smooth", erase: false };
}
export function saveBrushStyle(style) {
  // Eraser is a transient mode, not a saved preference.
  try {
    localStorage.setItem(BRUSH_STYLE_KEY, JSON.stringify({
      color: style.color, size: style.size, eraseSize: style.eraseSize, opacity: style.opacity, texture: style.texture,
    }));
  } catch { /* */ }
}
// The size that applies right now depends on which mode (brush vs eraser) is on.
export const activeBrushSize = (s) => (s.erase ? (s.eraseSize ?? 32) : s.size);

// Chosen laser colour (per device). null = fall back to my cursor colour.
const LASER_COLOR_KEY = "ql_wb_laser_color";
export function loadLaserColor() {
  try { return localStorage.getItem(LASER_COLOR_KEY) || null; } catch { return null; }
}
export function saveLaserColor(c) {
  try { if (c) localStorage.setItem(LASER_COLOR_KEY, c); } catch { /* */ }
}
