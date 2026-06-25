// Shared background-effect helpers used by BOTH the in-call controls
// (LiveKitCall) and the pre-join preview (RoomVideoStage's green room + join
// dock). Keeping the pref keys, presets, and the descriptor→options mapping in
// one place means a blur/background you set before joining is exactly what the
// call publishes — they read/write the same localStorage pref.

export const BG_PREF_KEY = "ql_lk_bg";
export const BG_CUSTOM_PREF_KEY = "ql_lk_bg_custom";

// Blur levels (radius descriptor → label). Shared so the in-call menu and the
// pre-join picker can't drift apart.
export const BLUR_LEVELS = [
  { id: "blur:4", label: "Light" },
  { id: "blur:9", label: "Medium" },
  { id: "blur:18", label: "Strong" },
];

// Built-in virtual backgrounds — gradients drawn on a canvas so we ship no
// binary image assets. The same gradient backs the menu thumbnail (CSS) and the
// processor (this canvas data URL), so they match exactly.
export const BG_PRESETS = [
  { id: "ocean", label: "Ocean", colors: ["#0ea5e9", "#0f766e"] },
  { id: "sunset", label: "Sunset", colors: ["#fb923c", "#db2777"] },
  { id: "violet", label: "Violet", colors: ["#7c3aed", "#2563eb"] },
  { id: "forest", label: "Forest", colors: ["#16a34a", "#0f766e"] },
  { id: "slate", label: "Slate", colors: ["#475569", "#0f172a"] },
];

const _bgUrlCache = {};
export function bgPresetUrl(id) {
  if (_bgUrlCache[id]) return _bgUrlCache[id];
  const preset = BG_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  try {
    const w = 1280, h = 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, preset.colors[0]);
    g.addColorStop(1, preset.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    _bgUrlCache[id] = c.toDataURL("image/jpeg", 0.85);
    return _bgUrlCache[id];
  } catch {
    return null;
  }
}

// Map a bg descriptor ("none" | "blur:<r>" | "image:<id|custom>") to the refined
// processor's options. Returns null for "none" or an unresolved image.
export function bgToOptions(bg, customBg) {
  if (!bg || bg === "none") return null;
  if (bg.startsWith("blur:")) return { mode: "blur", blurRadius: parseInt(bg.slice(5), 10) || 10 };
  if (bg.startsWith("image:")) {
    const key = bg.slice(6);
    const url = key === "custom" ? customBg : bgPresetUrl(key);
    return url ? { mode: "image", imageUrl: url } : null;
  }
  return null;
}

export function loadBgPref() {
  try { return localStorage.getItem(BG_PREF_KEY) || "none"; } catch { return "none"; }
}
export function loadBgCustomPref() {
  try { return localStorage.getItem(BG_CUSTOM_PREF_KEY) || null; } catch { return null; }
}
export function saveBgPref(v) {
  try { localStorage.setItem(BG_PREF_KEY, v); } catch { /* ignore */ }
}
