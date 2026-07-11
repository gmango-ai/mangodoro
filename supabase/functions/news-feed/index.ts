// news-feed: server-side RSS/Atom proxy for the kiosk ticker. Browsers can't
// fetch feeds directly (CORS), so the kiosk calls this instead. PRESET feeds
// only (no arbitrary URLs → no SSRF). Returns headlines for one or MANY feeds
// at once (the ticker runs a line per source). Auth'd (verify_jwt).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// key → { url, name, category }. Multiple sources per category.
const FEEDS: Record<string, { url: string; name: string; category: string }> = {
  "bbc-world":    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World", category: "World" },
  "aljazeera":    { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera", category: "World" },
  "npr-world":    { url: "https://feeds.npr.org/1004/rss.xml", name: "NPR World", category: "World" },
  "bbc-us":       { url: "https://feeds.bbci.co.uk/news/us_and_canada/rss.xml", name: "BBC US", category: "US" },
  "npr-national": { url: "https://feeds.npr.org/1003/rss.xml", name: "NPR National", category: "US" },
  "bbc-business": { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business", category: "Business" },
  "npr-business": { url: "https://feeds.npr.org/1006/rss.xml", name: "NPR Business", category: "Business" },
  "hn":           { url: "https://hnrss.org/frontpage", name: "Hacker News", category: "Tech" },
  "verge":        { url: "https://www.theverge.com/rss/index.xml", name: "The Verge", category: "Tech" },
  "ars":          { url: "https://feeds.arstechnica.com/arstechnica/index", name: "Ars Technica", category: "Tech" },
  "techcrunch":   { url: "https://techcrunch.com/feed/", name: "TechCrunch", category: "Tech" },
  "bbc-science":  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", name: "BBC Science", category: "Science" },
  "npr-science":  { url: "https://feeds.npr.org/1007/rss.xml", name: "NPR Science", category: "Science" },
  "bbc-health":   { url: "https://feeds.bbci.co.uk/news/health/rss.xml", name: "BBC Health", category: "Health" },
  "bbc-sport":    { url: "https://feeds.bbci.co.uk/sport/rss.xml", name: "BBC Sport", category: "Sports" },
  "espn":         { url: "https://www.espn.com/espn/rss/news", name: "ESPN", category: "Sports" },
  "bbc-culture":  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", name: "BBC Culture", category: "Culture" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
      const a = c.match(/<link[^>]*href=["']([^"']+)["']/i);
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
    keys = keys.filter((k) => FEEDS[k]);
    if (!keys.length) keys = ["bbc-world", "bbc-business", "hn", "bbc-science"];

    const feeds = (await Promise.all(keys.slice(0, 8).map(fetchFeed))).filter(Boolean);
    const available = Object.entries(FEEDS).map(([key, f]) => ({ key, name: f.name, category: f.category }));
    return json(200, { feeds, available });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
