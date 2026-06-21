// Shared reaction presets. Kept in its own module so both the engine
// (EmoteOverlay) and the presentational bar (EmoteBar) can import them
// without a circular dependency.
export const EMOTES = [
  { key: "like",  glyph: "👍" },
  { key: "love",  glyph: "❤️" },
  { key: "party", glyph: "🎉" },
  { key: "fire",  glyph: "🔥" },
  { key: "clap",  glyph: "👏" },
  { key: "smile", glyph: "😊" },
];

export const GLYPH = Object.fromEntries(EMOTES.map((e) => [e.key, e.glyph]));
export const PRESET_GLYPHS = new Set(EMOTES.map((e) => e.glyph));
