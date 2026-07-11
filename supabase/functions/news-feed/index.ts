// news-feed: server-side RSS/Atom proxy for the kiosk news ticker. Browsers
// can't fetch feeds directly (CORS), so the kiosk calls this instead. Only
// PRESET feed keys are allowed (no arbitrary URLs → no SSRF). Returns recent
// headlines. Auth'd (verify_jwt) so only signed-in clients / devices call it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FEEDS: Record<string, { url: string; name: string }> = {
  world:    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World" },
  business: { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business" },
  tech:     { url: "https://hnrss.org/frontpage", name: "Hacker News" },
  science:  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", name: "BBC Science" },
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let key = url.searchParams.get("key") || "world";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.key) key = String(body.key);
    }
    const feed = FEEDS[key] || FEEDS.world;
    const res = await fetch(feed.url, { headers: { "User-Agent": "Mangodoro-Kiosk/1.0" } });
    if (!res.ok) return json(502, { error: "feed fetch failed", status: res.status });
    const items = parseFeed(await res.text());
    return json(200, { source: feed.name, key, items });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
