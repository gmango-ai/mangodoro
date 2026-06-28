// City → timezone search over the slim dataset baked by
// scripts/gen-city-timezones.mjs (src/data/cityTimezones.json). Lets an admin
// type ANY city (Boston, Manchester, Cebu…) and resolve its IANA timezone,
// instead of being limited to the ~450 zone-id cities Intl exposes.
//
// The dataset (~7.3k cities, ~120KB gzipped) is lazy-loaded on first search so
// it never weighs down the main bundle — only an admin opening the world-clock
// editor pays for it. Each row is a positional tuple:
//   [city, province, country, tz, pop]   (pop-sorted, biggest first)

const CITY = 0, PROVINCE = 1, COUNTRY = 2, TZ = 3, POP = 4;

let _indexPromise;
function loadIndex() {
  return (_indexPromise ||= import("../data/cityTimezones.json").then((m) => {
    const rows = m.default || m;
    // Precompute a lowercased haystack per row so each keystroke is a cheap
    // substring test rather than re-lowercasing the whole dataset.
    return rows.map((r) => ({
      city: r[CITY],
      province: r[PROVINCE],
      country: r[COUNTRY],
      tz: r[TZ],
      pop: r[POP] || 0,
      hay: `${r[CITY]} ${r[PROVINCE]} ${r[COUNTRY]}`.toLowerCase(),
    }));
  }));
}

// Warm the dataset (e.g. on focus) so the first keystroke feels instant.
export function preloadCities() {
  loadIndex().catch(() => { /* offline / chunk error — search just returns [] */ });
}

// Common alternate / former / colloquial names → the canonical name in the
// dataset, so someone typing the name they know still lands the right city.
// Applied only on a whole-query match (keeps it predictable).
const ALIASES = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  saigon: "ho chi minh",
  peking: "beijing",
  rangoon: "yangon",
  nyc: "new york",
  "new york city": "new york",
  brooklyn: "new york",
  manhattan: "new york",
  "washington dc": "washington",
  "washington d.c.": "washington",
};

// Rank: exact city > city prefix > city contains all terms > matched elsewhere
// (province/country). Ties broken by population (bigger city first).
function score(item, q, terms) {
  const city = item.city.toLowerCase();
  if (city === q) return 4;
  if (city.startsWith(q)) return 3;
  if (terms.every((t) => city.includes(t))) return 2;
  return 1;
}

export async function searchCities(query, limit = 8) {
  let q = (query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  if (ALIASES[q]) q = ALIASES[q];
  const terms = q.split(/\s+/).filter(Boolean);
  let index;
  try {
    index = await loadIndex();
  } catch {
    return [];
  }
  const matches = [];
  for (const item of index) {
    if (terms.every((t) => item.hay.includes(t))) {
      matches.push(item);
      // Rows are pop-sorted, so once we've gathered a healthy pool of the
      // biggest matches we can stop scanning the long tail.
      if (matches.length >= limit * 6) break;
    }
  }
  matches.sort((a, b) => score(b, q, terms) - score(a, q, terms) || b.pop - a.pop);
  return matches.slice(0, limit).map((m) => ({
    city: m.city,
    province: m.province,
    country: m.country,
    tz: m.tz,
  }));
}
