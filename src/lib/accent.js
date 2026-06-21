// Accent color palette. Each entry maps a stable slug (stored in
// user_settings.accent_color) to a curated set of CSS variable
// overrides for both light and dark themes.
//
// Each palette also carries a `break` color used by the pomodoro
// break mode. Picked as an ANALOGOUS hue of the primary accent — an
// adjacent family on the color wheel (~15-35° away), so it stays close
// enough to feel part of the same theme but distinct enough to read as
// "different mode". (Previously a split-complementary / opposite hue,
// which felt out of place.) Examples: teal→green, blue→indigo,
// violet→fuchsia, amber→orange, slate→sky.
//
// The CSS variable names already exist in src/index.css — overriding
// them at the document root flips every surface that reads them
// (buttons, focus rings, settings tabs, etc.). Tailwind classes that
// hard-code `text-cyan-*` / `bg-teal-*` won't switch — those are a
// larger refactor.

export const ACCENTS = [
  {
    key: "teal",
    label: "Teal",
    swatch: "#0d9488",
    light: {
      "--color-accent": "#0d9488",
      "--color-accent-hover": "#0f766e",
      "--color-accent-light": "#f0fdfa",
      "--color-accent-light-hover": "#ccfbf1",
      "--color-accent-border": "#99f6e4",
      "--color-accent-text": "#134e4a",
      "--color-accent-bright": "#14b8a6",
      "--color-break": "#16a34a",
      "--color-break-hover": "#15803d",
      "--color-break-light": "#f0fdf4",
    },
    dark: {
      "--color-accent": "#2dd4bf",
      "--color-accent-hover": "#5eead4",
      "--color-accent-light": "rgba(45, 212, 191, 0.12)",
      "--color-accent-light-hover": "rgba(45, 212, 191, 0.20)",
      "--color-accent-border": "rgba(45, 212, 191, 0.35)",
      "--color-accent-text": "#99f6e4",
      "--color-accent-bright": "#14b8a6",
      "--color-break": "#4ade80",
      "--color-break-hover": "#86efac",
      "--color-break-light": "rgba(74, 222, 128, 0.15)",
    },
  },
  {
    key: "cyan",
    label: "Cyan",
    swatch: "#0891b2",
    light: {
      "--color-accent": "#0891b2",
      "--color-accent-hover": "#0e7490",
      "--color-accent-light": "#ecfeff",
      "--color-accent-light-hover": "#cffafe",
      "--color-accent-border": "#a5f3fc",
      "--color-accent-text": "#155e75",
      "--color-accent-bright": "#06b6d4",
      "--color-break": "#2563eb",
      "--color-break-hover": "#1d4ed8",
      "--color-break-light": "#eff6ff",
    },
    dark: {
      "--color-accent": "#22d3ee",
      "--color-accent-hover": "#67e8f9",
      "--color-accent-light": "rgba(34, 211, 238, 0.12)",
      "--color-accent-light-hover": "rgba(34, 211, 238, 0.20)",
      "--color-accent-border": "rgba(34, 211, 238, 0.35)",
      "--color-accent-text": "#a5f3fc",
      "--color-accent-bright": "#06b6d4",
      "--color-break": "#60a5fa",
      "--color-break-hover": "#93c5fd",
      "--color-break-light": "rgba(96, 165, 250, 0.15)",
    },
  },
  {
    key: "blue",
    label: "Blue",
    swatch: "#2563eb",
    light: {
      "--color-accent": "#2563eb",
      "--color-accent-hover": "#1d4ed8",
      "--color-accent-light": "#eff6ff",
      "--color-accent-light-hover": "#dbeafe",
      "--color-accent-border": "#bfdbfe",
      "--color-accent-text": "#1e3a8a",
      "--color-accent-bright": "#3b82f6",
      "--color-break": "#4f46e5",
      "--color-break-hover": "#4338ca",
      "--color-break-light": "#eef2ff",
    },
    dark: {
      "--color-accent": "#60a5fa",
      "--color-accent-hover": "#93c5fd",
      "--color-accent-light": "rgba(96, 165, 250, 0.12)",
      "--color-accent-light-hover": "rgba(96, 165, 250, 0.20)",
      "--color-accent-border": "rgba(96, 165, 250, 0.35)",
      "--color-accent-text": "#bfdbfe",
      "--color-accent-bright": "#3b82f6",
      "--color-break": "#818cf8",
      "--color-break-hover": "#a5b4fc",
      "--color-break-light": "rgba(129, 140, 248, 0.15)",
    },
  },
  {
    key: "indigo",
    label: "Indigo",
    swatch: "#4f46e5",
    light: {
      "--color-accent": "#4f46e5",
      "--color-accent-hover": "#4338ca",
      "--color-accent-light": "#eef2ff",
      "--color-accent-light-hover": "#e0e7ff",
      "--color-accent-border": "#c7d2fe",
      "--color-accent-text": "#312e81",
      "--color-accent-bright": "#6366f1",
      "--color-break": "#7c3aed",
      "--color-break-hover": "#6d28d9",
      "--color-break-light": "#f5f3ff",
    },
    dark: {
      "--color-accent": "#818cf8",
      "--color-accent-hover": "#a5b4fc",
      "--color-accent-light": "rgba(129, 140, 248, 0.12)",
      "--color-accent-light-hover": "rgba(129, 140, 248, 0.20)",
      "--color-accent-border": "rgba(129, 140, 248, 0.35)",
      "--color-accent-text": "#c7d2fe",
      "--color-accent-bright": "#6366f1",
      "--color-break": "#a78bfa",
      "--color-break-hover": "#c4b5fd",
      "--color-break-light": "rgba(167, 139, 250, 0.15)",
    },
  },
  {
    key: "violet",
    label: "Violet",
    swatch: "#7c3aed",
    light: {
      "--color-accent": "#7c3aed",
      "--color-accent-hover": "#6d28d9",
      "--color-accent-light": "#f5f3ff",
      "--color-accent-light-hover": "#ede9fe",
      "--color-accent-border": "#ddd6fe",
      "--color-accent-text": "#4c1d95",
      "--color-accent-bright": "#8b5cf6",
      "--color-break": "#c026d3",
      "--color-break-hover": "#a21caf",
      "--color-break-light": "#fdf4ff",
    },
    dark: {
      "--color-accent": "#a78bfa",
      "--color-accent-hover": "#c4b5fd",
      "--color-accent-light": "rgba(167, 139, 250, 0.12)",
      "--color-accent-light-hover": "rgba(167, 139, 250, 0.20)",
      "--color-accent-border": "rgba(167, 139, 250, 0.35)",
      "--color-accent-text": "#ddd6fe",
      "--color-accent-bright": "#8b5cf6",
      "--color-break": "#e879f9",
      "--color-break-hover": "#f0abfc",
      "--color-break-light": "rgba(232, 121, 249, 0.15)",
    },
  },
  {
    key: "pink",
    label: "Pink",
    swatch: "#db2777",
    light: {
      "--color-accent": "#db2777",
      "--color-accent-hover": "#be185d",
      "--color-accent-light": "#fdf2f8",
      "--color-accent-light-hover": "#fce7f3",
      "--color-accent-border": "#fbcfe8",
      "--color-accent-text": "#831843",
      "--color-accent-bright": "#ec4899",
      "--color-break": "#e11d48",
      "--color-break-hover": "#be123c",
      "--color-break-light": "#fff1f2",
    },
    dark: {
      "--color-accent": "#f472b6",
      "--color-accent-hover": "#f9a8d4",
      "--color-accent-light": "rgba(244, 114, 182, 0.12)",
      "--color-accent-light-hover": "rgba(244, 114, 182, 0.20)",
      "--color-accent-border": "rgba(244, 114, 182, 0.35)",
      "--color-accent-text": "#fbcfe8",
      "--color-accent-bright": "#ec4899",
      "--color-break": "#fb7185",
      "--color-break-hover": "#fda4af",
      "--color-break-light": "rgba(251, 113, 133, 0.15)",
    },
  },
  {
    key: "rose",
    label: "Rose",
    swatch: "#e11d48",
    light: {
      "--color-accent": "#e11d48",
      "--color-accent-hover": "#be123c",
      "--color-accent-light": "#fff1f2",
      "--color-accent-light-hover": "#ffe4e6",
      "--color-accent-border": "#fecdd3",
      "--color-accent-text": "#881337",
      "--color-accent-bright": "#f43f5e",
      "--color-break": "#dc2626",
      "--color-break-hover": "#b91c1c",
      "--color-break-light": "#fef2f2",
    },
    dark: {
      "--color-accent": "#fb7185",
      "--color-accent-hover": "#fda4af",
      "--color-accent-light": "rgba(251, 113, 133, 0.12)",
      "--color-accent-light-hover": "rgba(251, 113, 133, 0.20)",
      "--color-accent-border": "rgba(251, 113, 133, 0.35)",
      "--color-accent-text": "#fecdd3",
      "--color-accent-bright": "#f43f5e",
      "--color-break": "#f87171",
      "--color-break-hover": "#fca5a5",
      "--color-break-light": "rgba(248, 113, 113, 0.15)",
    },
  },
  {
    key: "amber",
    label: "Amber",
    swatch: "#d97706",
    light: {
      "--color-accent": "#d97706",
      "--color-accent-hover": "#b45309",
      "--color-accent-light": "#fffbeb",
      "--color-accent-light-hover": "#fef3c7",
      "--color-accent-border": "#fde68a",
      "--color-accent-text": "#78350f",
      "--color-accent-bright": "#f59e0b",
      "--color-break": "#ea580c",
      "--color-break-hover": "#c2410c",
      "--color-break-light": "#fff7ed",
    },
    dark: {
      "--color-accent": "#fbbf24",
      "--color-accent-hover": "#fcd34d",
      "--color-accent-light": "rgba(251, 191, 36, 0.12)",
      "--color-accent-light-hover": "rgba(251, 191, 36, 0.20)",
      "--color-accent-border": "rgba(251, 191, 36, 0.35)",
      "--color-accent-text": "#fde68a",
      "--color-accent-bright": "#f59e0b",
      "--color-break": "#fb923c",
      "--color-break-hover": "#fdba74",
      "--color-break-light": "rgba(251, 146, 60, 0.15)",
    },
  },
  {
    key: "emerald",
    label: "Emerald",
    swatch: "#059669",
    light: {
      "--color-accent": "#059669",
      "--color-accent-hover": "#047857",
      "--color-accent-light": "#ecfdf5",
      "--color-accent-light-hover": "#d1fae5",
      "--color-accent-border": "#a7f3d0",
      "--color-accent-text": "#064e3b",
      "--color-accent-bright": "#10b981",
      "--color-break": "#0d9488",
      "--color-break-hover": "#0f766e",
      "--color-break-light": "#f0fdfa",
    },
    dark: {
      "--color-accent": "#34d399",
      "--color-accent-hover": "#6ee7b7",
      "--color-accent-light": "rgba(52, 211, 153, 0.12)",
      "--color-accent-light-hover": "rgba(52, 211, 153, 0.20)",
      "--color-accent-border": "rgba(52, 211, 153, 0.35)",
      "--color-accent-text": "#a7f3d0",
      "--color-accent-bright": "#10b981",
      "--color-break": "#2dd4bf",
      "--color-break-hover": "#5eead4",
      "--color-break-light": "rgba(45, 212, 191, 0.15)",
    },
  },
  {
    key: "slate",
    label: "Slate",
    swatch: "#475569",
    light: {
      "--color-accent": "#475569",
      "--color-accent-hover": "#334155",
      "--color-accent-light": "#f8fafc",
      "--color-accent-light-hover": "#f1f5f9",
      "--color-accent-border": "#cbd5e1",
      "--color-accent-text": "#1e293b",
      "--color-accent-bright": "#64748b",
      "--color-break": "#0284c7",
      "--color-break-hover": "#0369a1",
      "--color-break-light": "#f0f9ff",
    },
    dark: {
      "--color-accent": "#94a3b8",
      "--color-accent-hover": "#cbd5e1",
      "--color-accent-light": "rgba(148, 163, 184, 0.12)",
      "--color-accent-light-hover": "rgba(148, 163, 184, 0.20)",
      "--color-accent-border": "rgba(148, 163, 184, 0.35)",
      "--color-accent-text": "#e2e8f0",
      "--color-accent-bright": "#64748b",
      "--color-break": "#38bdf8",
      "--color-break-hover": "#7dd3fc",
      "--color-break-light": "rgba(56, 189, 248, 0.15)",
    },
  },
];

export function findAccent(key) {
  return ACCENTS.find((a) => a.key === key) || ACCENTS[0];
}

// Apply the accent's CSS variables to the document root. Called on
// mount and on settings/theme change.
//
// We pass `"important"` so the inline values beat the `.dark { ... }`
// class block in index.css, which defines its own --color-accent
// family at the same specificity (class-on-:root). Without important,
// the dark theme stayed teal regardless of which accent the user picked.
export function applyAccent(key, dark) {
  if (typeof document === "undefined") return;
  const accent = findAccent(key);
  const vars = dark ? accent.dark : accent.light;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value, "important");
  }
}
