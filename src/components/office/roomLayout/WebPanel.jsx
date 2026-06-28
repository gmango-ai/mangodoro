import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, ExternalLink, Youtube } from "lucide-react";

// Note: the app no longer sets COEP (see vite.config.js), so these are plain
// cross-origin iframes that load WITH cookies — logged-in embeds like Google
// Docs work (subject to the browser's normal third-party-cookie policy). Sites
// that send X-Frame-Options / CSP frame-ancestors still refuse; that's a
// server-side policy nothing client-side can override.

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
  const path = u.pathname;
  const seg = path.split("/").filter(Boolean);
  const web = (src) => ({ kind: "web", src });
  // Some embeds (Twitch) require a `parent` matching the embedding host.
  const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";

  // YouTube → embed player (kind "youtube" gets playback sync).
  let vid = null;
  if (host === "youtu.be") vid = seg[0];
  else if (host.endsWith("youtube.com")) {
    if (path === "/watch") vid = u.searchParams.get("v");
    else if (seg[0] === "shorts" || seg[0] === "embed" || seg[0] === "live") vid = seg[1];
  }
  if (vid) return { kind: "youtube", videoId: vid, src: `https://www.youtube.com/watch?v=${vid}` };

  // Vimeo
  if (host === "vimeo.com" && /^\d+$/.test(seg[0] || "")) return web(`https://player.vimeo.com/video/${seg[0]}`);
  if (host === "player.vimeo.com") return web(u.href);

  // Loom
  if (host === "loom.com" && seg[0] === "share" && seg[1]) return web(`https://www.loom.com/embed/${seg[1]}`);

  // Dailymotion
  if (host === "dailymotion.com" && seg[0] === "video" && seg[1]) return web(`https://www.dailymotion.com/embed/video/${seg[1]}`);
  if (host === "dai.ly" && seg[0]) return web(`https://www.dailymotion.com/embed/video/${seg[0]}`);

  // Twitch — channel or VOD (needs the embedding host as `parent`).
  if (host === "twitch.tv") {
    if (seg[0] === "videos" && seg[1]) return web(`https://player.twitch.tv/?video=${seg[1]}&parent=${parent}`);
    if (seg[0]) return web(`https://player.twitch.tv/?channel=${seg[0]}&parent=${parent}`);
  }

  // Spotify (track / album / playlist / episode / show / artist) → embed widget.
  if (host === "open.spotify.com") {
    const m = path.match(/\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) return web(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  }

  // SoundCloud → the widget player (takes the original URL).
  if (host === "soundcloud.com") return web(`https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&visual=true`);

  // Figma (file / design / proto / board) → embed.
  if (host === "figma.com" && ["file", "design", "proto", "board"].includes(seg[0])) {
    return web(`https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.href)}`);
  }

  // CodePen / CodeSandbox / StackBlitz
  if (host === "codepen.io" && seg[1] === "pen" && seg[2]) return web(`https://codepen.io/${seg[0]}/embed/${seg[2]}?default-tab=result`);
  if (host === "codesandbox.io" && seg[0] === "s" && seg[1]) return web(`https://codesandbox.io/embed/${seg[1]}`);
  if (host === "stackblitz.com" && seg[0] === "edit" && seg[1]) return web(`https://stackblitz.com/edit/${seg[1]}?embed=1`);

  // Google Docs / Sheets / Slides / Drive → the official /preview embed endpoint.
  // The /edit URL needs your Google LOGIN cookie, which browsers block as a
  // cross-site cookie inside an iframe (→ 401). /preview works for a link-shared
  // ("anyone with the link") doc with NO login, dodging that entirely.
  if (host === "docs.google.com" || host === "drive.google.com") {
    const m = path.match(/\/(document|spreadsheets|presentation|file)\/d\/([^/]+)/);
    if (m) {
      const h = m[1] === "file" ? "drive.google.com" : "docs.google.com";
      return web(`https://${h}/${m[1]}/d/${m[2]}/preview`);
    }
  }

  // Google Maps → embeddable output.
  if ((host === "google.com" || host.endsWith(".google.com")) && path.startsWith("/maps")) {
    u.searchParams.set("output", "embed");
    return web(u.href);
  }

  return web(u.href);
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

  const src = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(origin)}`;
  }, [videoId]);

  // Attach YT.Player to our own iframe for the playback sync.
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

  return (
    <iframe
      key={videoId}
      ref={iframeRef}
      src={src}
      title="Shared YouTube"
      className="absolute inset-0 w-full h-full border-0"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
    />
  );
}

// Generic site frame — sandboxed (no top-navigation hijack), loads with cookies.
// Sites that send X-Frame-Options / CSP frame-ancestors refuse to load; we can't
// override that, so we detect the likely block (the frame never fires `load`
// within a few seconds) and show a clean "open in a new tab" card instead of the
// browser's raw error. `load` firing hides it (handles slow loads + late loads).
function GenericFrame({ src, url }) {
  const loadedRef = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    loadedRef.current = false;
    setBlocked(false);
    const t = setTimeout(() => { if (!loadedRef.current) setBlocked(true); }, 7000);
    return () => clearTimeout(t);
  }, [src, tries]);
  return (
    <div className="absolute inset-0">
      <iframe
        key={`${src}#${tries}`}
        src={src}
        title="Shared web view"
        onLoad={() => { loadedRef.current = true; setBlocked(false); }}
        className="absolute inset-0 w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
        sandbox={SANDBOX}
      />
      {blocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 bg-slate-900/96 text-slate-300">
          <Globe className="w-8 h-8 opacity-40" />
          <p className="text-sm font-semibold text-slate-200">This site can&apos;t be embedded</p>
          <p className="text-xs max-w-[300px]">It blocks being shown inside another page. Open it in a new tab instead — everyone here has the same link.</p>
          <div className="flex items-center gap-2 pt-1">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-[12px] font-semibold"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
            </a>
            <button
              type="button"
              onClick={() => setTries((t) => t + 1)}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-slate-200 text-[12px] font-semibold"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
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
            href={embed?.kind === "youtube" ? `https://www.youtube.com/watch?v=${embed.videoId}` : url}
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
          <GenericFrame src={embed.src} url={url} />
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
