// news-feed: server-side RSS/Atom proxy for the kiosk news ticker. Browsers
// can't fetch feeds directly (CORS), so the kiosk calls this instead. Only
// PRESET feed keys are allowed (no arbitrary URLs → no SSRF). Returns headlines
// for one or MANY feeds at once (the ticker runs a line per source). Auth'd
// (verify_jwt) so only signed-in clients / devices call it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FEEDS: Record<string, { url: string; name: string }> = {
  world:    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "World" },
  us:       { url: "https://feeds.bbci.co.uk/news/us_and_canada/rss.xml", name: "US" },
  business: { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "Business" },
  tech:     { url: "https://hnrss.org/frontpage", name: "Tech" },
  science:  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", name: "Science" },
  health:   { url: "https://feeds.bbci.co.uk/news/health/rss.xml", name: "Health" },
  sports:   { url: "https://feeds.bbci.co.uk/sport/rss.xml", name: "Sports" },
  culture:  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", name: "Culture" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Unwrap CDATA, decode the common entities, and strip any stray tags.
function clean(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Loose RSS (<item>) + Atom (<entry>) parse — just titles + links.
function parseFeed(xml: string): { title: string; link: string }[] {
  const items: { title: string; link: string }[] = [];
  const chunks = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  for (const c of chunks) {
    const t = c.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = t ? clean(t[1]) : "";
    let link = "";
    const l = c.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (l && clean(l[1])) link = clean(l[1]);
    else {
      const a = c.match(/<link[^>]*href=["']([^"']+)["']/i); // Atom
      if (a) link = a[1];
    }
    if (title) items.push({ title, link });
    if (items.length >= 25) break;
  }
  return items;
}

async function fetchFeed(k: string) {
  const f = FEEDS[k];
  if (!f) return null;
  try {
    const res = await fetch(f.url, { headers: { "User-Agent": "Mangodoro-Kiosk/1.0" } });
    if (!res.ok) return { key: k, source: f.name, items: [] };
    return { key: k, source: f.name, items: parseFeed(await res.text()) };
  } catch {
    return { key: k, source: f.name, items: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let keys: string[] = [];
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.keys)) keys = body.keys.map(String);
      else if (body?.key) keys = [String(body.key)];
    }
    if (!keys.length) {
      const q = new URL(req.url).searchParams.get("keys") || new URL(req.url).searchParams.get("key");
      if (q) keys = q.split(",");
    }
    // Only known keys; default to a sensible spread.
    keys = keys.filter((k) => FEEDS[k]);
    if (!keys.length) keys = ["world", "business", "tech", "science"];

    const feeds = (await Promise.all(keys.slice(0, 8).map(fetchFeed))).filter(Boolean);
    return json(200, { feeds, available: Object.entries(FEEDS).map(([key, f]) => ({ key, name: f.name })) });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
