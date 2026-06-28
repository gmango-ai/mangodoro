import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Globe, ExternalLink, Youtube } from "lucide-react";

// The app sets COEP (for SharedArrayBuffer / RVM matting), which otherwise
// BLOCKS cross-origin iframes — Chrome reports that as "refused to connect"
// (ERR_BLOCKED_BY_RESPONSE), easily mistaken for X-Frame-Options. The
// `credentialless` iframe attribute opts a single cross-origin frame out of that
// (loads it without credentials), so embeds like YouTube work under our COEP.
// It MUST be present before the src loads, so we set it imperatively, then src.
function setCredentiallessSrc(el, src) {
  if (!el) return;
  try { el.setAttribute("credentialless", ""); } catch { /* unsupported → still tries */ }
  if (el.getAttribute("src") !== src) el.setAttribute("src", src);
}

// A shared website tile. The URL is room-shared state (useRoomWeb): anyone can
// paste a link and everyone's tile loads it — watch a YouTube video together, or
// look at a doc, without screen-sharing it over the call. For YouTube, play /
// pause / seek are SYNCED across the room via the IFrame API.

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
  if (vid) return { kind: "youtube", videoId: vid, src: `https://www.youtube.com/watch?v=${vid}` };
  return { kind: "web", src: u.href };
}

// Embedding arbitrary sites is best-effort + a mild risk surface, so we sandbox:
// scripts + same-origin (so the framed app runs) and popups/forms, but NOT
// top-navigation (the framed page can't hijack our tab).
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation";

// Load the YouTube IFrame API once, resolving to window.YT.
let _ytPromise;
function loadYT() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_ytPromise) return _ytPromise;
  _ytPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* */ } resolve(window.YT); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return _ytPromise;
}

// A YouTube player whose play/pause/seek is shared with the room. `playback` is
// the latest shared state ({ playing, time, ts, by }); `onPlayback` broadcasts a
// local change. We guard both directions so applying a peer's state doesn't echo
// back as our own.
function YouTubePlayer({ videoId, playback, onPlayback, meId }) {
  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const suppressUntil = useRef(0); // ignore state changes we caused while applying remote

  const emit = useCallback((playing) => {
    const p = playerRef.current;
    if (!p) return;
    try { onPlayback({ playing, time: p.getCurrentTime() }); } catch { /* */ }
  }, [onPlayback]);

  // Apply the shared playback to the local player (skip our own echo).
  const applyRemote = useCallback(() => {
    const p = playback;
    const player = playerRef.current;
    if (!p || !player || !readyRef.current || p.by === meId) return;
    const target = p.playing ? p.time + Math.max(0, (Date.now() - (p.ts || Date.now())) / 1000) : p.time;
    suppressUntil.current = Date.now() + 1500;
    try {
      const cur = player.getCurrentTime();
      if (Math.abs(cur - target) > 1.2) player.seekTo(target, true);
      if (p.playing) player.playVideo(); else player.pauseVideo();
    } catch { /* */ }
  }, [playback, meId]);

  // We OWN the iframe (so we can mark it credentialless to satisfy COEP), and
  // attach YT.Player to it for the playback sync. Set credentialless + src
  // before the API attaches.
  useLayoutEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(origin)}`;
    setCredentiallessSrc(iframeRef.current, src);
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    loadYT().then((YT) => {
      if (cancelled || !iframeRef.current) return;
      playerRef.current = new YT.Player(iframeRef.current, {
        events: {
          onReady: () => { readyRef.current = true; applyRemote(); },
          onStateChange: (e) => {
            if (Date.now() < suppressUntil.current) return; // echo from applyRemote
            const S = window.YT?.PlayerState || {};
            if (e.data === S.PLAYING) emit(true);
            else if (e.data === S.PAUSED) emit(false);
          },
        },
      });
    }).catch(() => { /* API blocked — the iframe still plays, just unsynced */ });
    return () => {
      cancelled = true;
      readyRef.current = false;
      try { playerRef.current?.destroy(); } catch { /* */ }
      playerRef.current = null;
    };
    // Re-attach only when the video changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // React to shared-state changes.
  useEffect(() => { applyRemote(); }, [applyRemote]);

  // No src in JSX — set imperatively above so `credentialless` lands first.
  return (
    <iframe
      key={videoId}
      ref={iframeRef}
      title="Shared YouTube"
      className="absolute inset-0 w-full h-full border-0"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
    />
  );
}

// Generic site frame — credentialless (so COEP doesn't block it) + sandboxed.
// Sites that send X-Frame-Options / CSP frame-ancestors still refuse; nothing
// client-side can override that (it's the site's server policy).
function GenericFrame({ src }) {
  const ref = useRef(null);
  useLayoutEffect(() => { setCredentiallessSrc(ref.current, src); }, [src]);
  return (
    <iframe
      key={src}
      ref={ref}
      title="Shared web view"
      className="absolute inset-0 w-full h-full border-0"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
      allowFullScreen
      sandbox={SANDBOX}
    />
  );
}

export default function WebPanel({ url, onSetUrl, dark, playback, onPlayback, meId }) {
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
        {embed?.kind === "youtube" && (
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-emerald-400 px-1" title="Play / pause / seek are synced for everyone">
            Synced
          </span>
        )}
        {url && (
          <a
            href={embed?.kind === "youtube" ? `https://www.youtube.com/watch?v=${embed.videoId}` : (embed?.src || url)}
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
        {embed?.kind === "youtube" ? (
          <YouTubePlayer videoId={embed.videoId} playback={playback} onPlayback={onPlayback} meId={meId} />
        ) : embed ? (
          <GenericFrame src={embed.src} />
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
