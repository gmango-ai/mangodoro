// Default node sizes used by the toolbar's "+ Sticky / + Text / + Rect
// / + Ellipse" buttons. We keep them small so they fit visually inside
// template zones without overflowing.
export const DEFAULTS = {
  sticky: { w: 144, h: 144 },
  text: { w: 220, h: 60 },
  rect: { w: 180, h: 100 },
  ellipse: { w: 180, h: 110 },
  diamond: { w: 150, h: 110 },
  shape: { w: 180, h: 100 },
  goal: { w: 240, h: 150 },
  frame: { w: 600, h: 840 },
  image: { w: 240, h: 180 },
};

// Floating toolbar shown while the brush is active — brush/eraser, colour, size
// and opacity in one place (room to grow: brush types, smoothing, etc.).
// 44px tool targets on touch (Apple HIG); compact 32px with a mouse.
export const WB_TOUCH =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
// Once a stylus (Apple Pencil) has touched down, concurrent finger/palm touches
// are treated as palm and ignored for this window after the last pen event —
// palm rejection that still lets stylus-less users draw with a finger.
export const PEN_GRACE_MS = 900;

// Multi-finger tap gestures: 2-finger tap = undo, 3-finger tap = redo (the
// iPad-native convention). A tap is quick, with a near-still centroid and
// spread — any real pan/pinch moves those and cancels the gesture.
export const TAP_GESTURE_MS = 300;   // max duration to still count as a tap
export const TAP_GESTURE_SLOP = 12;  // px of centroid/spread drift allowed
export const TOOL_BTN_SIZE = WB_TOUCH ? "w-11 h-11" : "w-8 h-8";
// Tool + its options caret read as one grouped row on touch.
export const TOOL_GROUP_CLS = WB_TOUCH ? "relative flex items-center" : "relative";
export const BOTTOM_PANEL_GAP = 8;
export const PAINT_TOOLBAR_STACK_H = 54;
export const TOUCH_INSPECTOR_FALLBACK_H = 54;

// Touch: the 14px corner caret is untappable — full-height chevron grouped
// beside the tool instead.
export const CARET_CLS = WB_TOUCH
  ? "w-7 h-11 -ml-1.5 rounded-full flex items-center justify-center"
  : "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow";
