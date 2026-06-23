// Whiteboard text fonts: built-in presets + on-demand Google Fonts.
//
// Loading any Google font is KEYLESS — we inject the CSS API stylesheet on
// demand. This curated list is just the *browse* set; the full ~1500-font
// catalogue would need the Webfonts metadata API + a key (a follow-up).

// Built-in presets (system stacks). "sans" / unset inherits the app font.
export const FONT_PRESETS = {
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  hand: "'Comic Sans MS', 'Comic Sans', 'Bradley Hand', cursive",
};
export const PRESET_OPTIONS = [
  ["Sans", "sans"], ["Serif", "serif"], ["Mono", "mono"], ["Hand", "hand"],
];

// ~150 popular Google Fonts, grouped loosely for a sensible default order.
export const GOOGLE_FONTS = [
  // Sans
  "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Nunito",
  "Nunito Sans", "Raleway", "Work Sans", "Source Sans 3", "Noto Sans", "PT Sans",
  "Rubik", "Karla", "DM Sans", "Manrope", "Barlow", "Oswald", "Hind", "Heebo",
  "Cabin", "Quicksand", "Josefin Sans", "Mulish", "Fira Sans", "Titillium Web",
  "Archivo", "Outfit", "Public Sans", "Albert Sans", "Figtree",
  "Plus Jakarta Sans", "Sora", "Space Grotesk", "Lexend", "Red Hat Display",
  "Assistant", "Kanit", "Prompt", "Signika", "Maven Pro", "Asap", "Saira",
  "Overpass", "Jost", "Be Vietnam Pro", "Onest", "Mukta", "Dosis",
  // Serif
  "Playfair Display", "Merriweather", "Lora", "PT Serif", "Noto Serif",
  "Roboto Slab", "Bitter", "Crimson Text", "Libre Baskerville", "EB Garamond",
  "Cormorant Garamond", "Source Serif 4", "Domine", "Arvo", "Zilla Slab",
  "Spectral", "Frank Ruhl Libre", "Cardo", "Vollkorn", "Bree Serif",
  "Alegreya", "Bodoni Moda", "DM Serif Display", "DM Serif Text", "Marcellus",
  "Cinzel", "Newsreader", "Fraunces", "Lustria", "Petrona", "Slabo 27px",
  "Libre Caslon Text", "Josefin Slab", "Crimson Pro",
  // Mono
  "Roboto Mono", "Source Code Pro", "JetBrains Mono", "Fira Code",
  "Inconsolata", "IBM Plex Mono", "Space Mono", "Ubuntu Mono", "PT Mono",
  "DM Mono", "Overpass Mono", "Red Hat Mono",
  // Display
  "Bebas Neue", "Anton", "Abril Fatface", "Lobster", "Righteous", "Comfortaa",
  "Fredoka", "Baloo 2", "Archivo Black", "Alfa Slab One", "Bungee",
  "Passion One", "Staatliches", "Teko", "Russo One", "Pathway Gothic One",
  "Concert One", "Bowlby One SC", "Titan One", "Luckiest Guy", "Bangers",
  // Handwriting / Script
  "Dancing Script", "Caveat", "Shadows Into Light", "Indie Flower",
  "Permanent Marker", "Satisfy", "Great Vibes", "Sacramento", "Kalam",
  "Patrick Hand", "Gloria Hallelujah", "Amatic SC", "Architects Daughter",
  "Courgette", "Cookie", "Handlee", "Marck Script", "Homemade Apple",
  "Pacifico", "Rock Salt", "Reenie Beanie", "Nanum Pen Script", "Yellowtail",
];

const _loaded = new Set();
// Inject the Google Fonts stylesheet for `family` once. No-op for presets, the
// "sans" default, or anything already loaded.
export function ensureGoogleFont(family) {
  if (!family || family === "sans" || FONT_PRESETS[family]) return;
  if (_loaded.has(family)) return;
  _loaded.add(family);
  try {
    const id = `gf-${family.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    if (typeof document === "undefined" || document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/\s+/g, "+")}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
  } catch {
    /* */
  }
}

// Resolve data.fontFamily → a CSS font-family value (undefined = inherit).
export function fontStack(fam) {
  if (!fam || fam === "sans") return undefined;
  if (FONT_PRESETS[fam]) return FONT_PRESETS[fam];
  return `'${fam}', sans-serif`; // Google font (load via ensureGoogleFont)
}
