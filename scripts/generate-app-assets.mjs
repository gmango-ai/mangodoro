// Renders public/logo.svg into the 1024x1024 / 2732x2732 source PNGs
// that @capacitor/assets expects in ./assets/. Run with `bun run
// gen:app-assets`, then `bunx @capacitor/assets generate` to fan out
// into all the platform-specific sizes.

import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";

const SVG_PATH = "public/logo.svg";
const OUT_DIR = "assets";

const BRAND_ORANGE = "#EF8148";
// Diagonal brand gradient sampled from the master logo (top-left → bottom-right).
const GRAD_TL = "#EC785A";
const GRAD_BR = "#F6A40A";
const LIGHT_BG = "#ffffff";
const DARK_BG = "#0f172a";
const WHITE = "#ffffff";

const svgRaw = readFileSync(SVG_PATH, "utf8");

// The logo's fill="currentColor" inherits from CSS, which Sharp's
// librsvg renderer treats as black. Swap to the desired hex before
// rasterising.
function svgWithFill(color) {
  return svgRaw.replace(/fill="currentColor"/, `fill="${color}"`);
}

async function renderLogo(color, size) {
  const svg = svgWithFill(color);
  return sharp(Buffer.from(svg), { density: 400 })
    .resize(size, size)
    .png()
    .toBuffer();
}

// A diagonal linear-gradient background rasterised at `size`.
async function gradientBg(size, c1, c2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>`
    + `</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function composite({ canvasSize, bgColor, bgGradient, logoColor, logoScale, outPath }) {
  const logoSize = Math.round(canvasSize * logoScale);
  const logoBuf = await renderLogo(logoColor, logoSize);
  const base = bgGradient
    ? sharp(await gradientBg(canvasSize, bgGradient[0], bgGradient[1]))
    : sharp({
        create: { width: canvasSize, height: canvasSize, channels: 4, background: bgColor },
      });
  await base
    .composite([{
      input: logoBuf,
      top: Math.round((canvasSize - logoSize) / 2),
      left: Math.round((canvasSize - logoSize) / 2),
    }])
    .png()
    .toFile(outPath);
  console.log(`  → ${outPath} (${canvasSize}x${canvasSize})`);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log("Generating app assets from public/logo.svg…");

// iOS / primary Android icon: white logo on the brand gradient. 0.6 fill
// ratio gives iOS-style margins without looking small.
await composite({
  canvasSize: 1024,
  bgGradient: [GRAD_TL, GRAD_BR],
  logoColor: WHITE,
  logoScale: 0.6,
  outPath: `${OUT_DIR}/icon-only.png`,
});

// Android adaptive icon: foreground layer with logo placed inside the
// safe zone (≈0.4 scale leaves room for the system to mask/crop). The
// background layer is a solid teal PNG so the masked view sees the
// brand color through any clip shape (circle, squircle, etc.).
await composite({
  canvasSize: 1024,
  bgColor: { r: 0, g: 0, b: 0, alpha: 0 },
  logoColor: WHITE,
  logoScale: 0.4,
  outPath: `${OUT_DIR}/icon-foreground.png`,
});
await composite({
  canvasSize: 1024,
  bgGradient: [GRAD_TL, GRAD_BR],
  logoColor: WHITE, // logo invisible at this scale — background only
  logoScale: 0.01,
  outPath: `${OUT_DIR}/icon-background.png`,
});

// Splash screens: branded but minimal — large solid background with the
// logo centred at ~22% so it doesn't dominate. iOS displays its own
// crop of this canvas based on device size, so we render the canvas
// square and trust the storyboard scaleAspectFill.
await composite({
  canvasSize: 2732,
  bgColor: LIGHT_BG,
  logoColor: BRAND_ORANGE,
  logoScale: 0.22,
  outPath: `${OUT_DIR}/splash.png`,
});
await composite({
  canvasSize: 2732,
  bgColor: DARK_BG,
  logoColor: WHITE,
  logoScale: 0.22,
  outPath: `${OUT_DIR}/splash-dark.png`,
});

console.log("\nDone. Run `bunx @capacitor/assets generate` next.");
