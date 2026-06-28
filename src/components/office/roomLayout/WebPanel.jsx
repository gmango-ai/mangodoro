import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, ExternalLink, Youtube } from "lucide-react";

// A shared website tile. The URL is room-shared state (useRoomWeb): anyone can
// paste a link and everyone's tile loads it — watch a YouTube video together, or
// look at a doc, without screen-sharing it over the call. (YouTube play/pause/
// seek sync is layered on in a follow-up via the IFrame API.)

// Parse a URL into an embeddable source. YouTube is special-cased to its /embed/
// player (with the JS API enabled so playback sync can hook it); everything else
// is framed as-is (best effort — some sites refuse to be embedded).
export function parseEmbed(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url.includes("://") ? url : `https://${url}`); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  let vid = null;
  if (host === "youtu.be") vid = u.pathname.slice(1);
  else if (host.endsWith("youtube.com")) {
    if (u.pathname === "/watch") vid = u.searchParams.get("v");
    else if (u.pathname.startsWith("/shorts/")) vid = u.pathname.split("/")[2];
    else if (u.pathname.startsWith("/embed/")) vid = u.pathname.split("/")[2];
  }
  if (vid) {
    return { kind: "youtube", videoId: vid, src: `https://www.youtube.com/embed/${vid}?enablejsapi=1&rel=0&modestbranding=1` };
  }
  return { kind: "web", src: u.href };
}

// Embedding arbitrary sites is inherently best-effort + a mild risk surface, so
// we sandbox: scripts + same-origin (so the framed app runs) and popups/forms,
// but NOT top-navigation (the framed page can't hijack our tab).
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation";

export default function WebPanel({ url, onSetUrl, dark }) {
  const [draft, setDraft] = useState(url || "");
  const inputRef = useRef(null);
  useEffect(() => { setDraft(url || ""); }, [url]);
  const embed = useMemo(() => parseEmbed(url), [url]);

  const submit = () => {
    const v = draft.trim();
    if (v !== (url || "")) onSetUrl(v);
    inputRef.current?.blur();
  };

  return (
    <div className="flex flex-col w-full h-full bg-black">
      {/* URL bar — anyone in the room can change it; the change syncs to all. */}
      <div className={`shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b ${dark ? "bg-slate-900 border-white/10" : "bg-slate-800 border-black/20"}`}>
        {embed?.kind === "youtube" ? <Youtube className="w-4 h-4 text-red-500 shrink-0" /> : <Globe className="w-4 h-4 text-slate-400 shrink-0" />}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setDraft(url || ""); }}
          onBlur={submit}
          placeholder="Paste a link — a YouTube video, a doc, anything embeddable"
          className="flex-1 min-w-0 bg-white/10 focus:bg-white/15 text-white text-[12px] rounded-md px-2 py-1 outline-none placeholder:text-white/40"
          spellCheck={false}
        />
        {url && (
          <a
            href={parseEmbed(url)?.src || url}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            className="shrink-0 p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {embed ? (
          <iframe
            // key on src so changing the URL reloads the frame cleanly.
            key={embed.src}
            src={embed.src}
            title="Shared web view"
            className="absolute inset-0 w-full h-full border-0"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            sandbox={SANDBOX}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 text-slate-400">
            <Globe className="w-8 h-8 opacity-40" />
            <p className="text-sm font-semibold text-slate-300">Share a website with the room</p>
            <p className="text-xs max-w-[280px]">
              Paste a link above — a YouTube video to watch together, a doc, a dashboard. Everyone here sees the same thing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
