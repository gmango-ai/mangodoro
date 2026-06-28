// Derive the slim world-clock city dataset from the `city-timezones` package
// (a devDependency). We don't import that 1.8MB package at runtime — instead we
// bake a compact, pop-sorted tuple array the city search lazy-loads.
//
// Output row shape (positional, documented in src/lib/citySearch.js):
//   [city, province, country, tz, pop]
//
// Regenerate with:  node scripts/gen-city-timezones.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(here, "../node_modules/city-timezones/data/cityMap.json");
const outPath = resolve(here, "../src/data/cityTimezones.json");

const cities = JSON.parse(readFileSync(srcPath, "utf8"));

const rows = cities
  .filter((c) => c.city && c.timezone)
  .map((c) => [
    c.city,
    c.province || c.state_ansi || "",
    c.country || "",
    c.timezone,
    Math.round(c.pop || 0),
  ])
  // Pop-sorted so the search can rank bigger cities first and cap its scan.
  .sort((a, b) => b[4] - a[4]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${rows.length} cities → ${outPath}`);
