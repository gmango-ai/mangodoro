import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Smile, X } from "lucide-react";
import { supabase } from "../../supabase";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";
import { GLYPH } from "./presets";
import EmoteBar from "./EmoteBar";

// EmoteOverlay — Google-Meet-style floating-reaction layer that any
// surface (whiteboard, video call, eventually rooms) can mount.
//
// Architecture:
//   * Every overlay subscribes to a Supabase Realtime "broadcast"
//     channel scoped by `channelKey` — e.g. `emote:room:abc-123` or
//     `emote:whiteboard:def-456`. Two surfaces with the same key see
//     each other's emotes; different keys are isolated.
//   * Clicking an emote button fires the particle locally for instant
//     feedback AND broadcasts to peers; we don't trust the round-trip
//     for our own click. Peers receive the broadcast and fire their
//     own local particle.
//   * Particles are a single rAF loop with a pooled DOM cap (120 max,
//     FIFO recycle) and a setTimeout backstop in case the tab is
//     hidden and rAF is throttled. No leaks under spam. Glyphs use a
//     baked text-shadow (not a drop-shadow filter) so the fountain
//     stays cheap to composite over a playing <video>.
//   * Each particle carries the sender's name as a small pill so you
//     can tell who reacted (your own included).
//
// The payload carries the actual emoji `glyph` (so any emoji works, not
// just the presets) plus the sender `name`. `key` is still sent for the
// six presets so a not-yet-updated peer can still resolve those via the
// legacy GLYPH map.
//
// The bar is render-prop'd via `barPosition` so callers can mount it
// at the bottom of a video stage, in a whiteboard toolbar, etc.

// Charge mechanic: a quick tap sends one; holding charges up and, on
// release, bursts a fountain whose size scales with how long it charged.
const CLICK_MS = 180;        // below this, a press counts as a single tap
const CHARGE_FULL_MS = 1500; // held this long (from press) = full charge
const BURST_MIN = 6;         // emojis in the smallest charged fountain
const BURST_MAX = 40;        // emojis at full charge (and the cap per burst)
const STREAM_INTERVAL_MS = 90; // cadence of constant-stream chunks past full charge
const STREAM_PER_TICK = 3;     // emojis emitted per stream chunk

// Recently-used emojis, per device. Quick access to anything you've
// picked from the full set without re-opening the picker.
const RECENTS_KEY = "ql_emote_recents";
function readRecents() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const EmoteOverlay = forwardRef(function EmoteOverlay({
  channelKey,
  // "bottom-center" (default) renders a horizontal bar at the bottom
  // of the relatively-positioned container we live inside.
  // "right-center" renders a vertical bar pinned to the right edge —
  // use this over a video call so the bar clears Jitsi's own
  // bottom toolbar. "hidden" suppresses the bar entirely — useful
  // when the caller wants its own UI but still wants peers' particles
  // to render.
  barPosition = "bottom-center",
  // Extra px to lift the horizontal bar off the bottom — lets a caller raise it
  // above another bottom-centre toolbar (e.g. the whiteboard paint toolbar).
  barOffset = 0,
  enabled = true,
  // Name shown under this user's reactions. Defaults to the session's
  // display name; callers with a curated name (e.g. the video call's
  // displayName) can pass it explicitly.
  senderName,
}, ref) {
  const vertical = barPosition === "right-center";
  // Defensive: this overlay can be mounted on surfaces that may not sit
  // under the App/Theme providers, and both contexts default to null.
  const session = useApp()?.session;
  const dark = (useTheme()?.theme) === "dark";
  const myName =
    senderName ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "Guest";

  // The video overlay collapses to a single side button (tap to pop the
  // reactions out) so it fits even the small PiP. The whiteboard bar
  // stays always-open.
  const [barOpen, setBarOpen] = useState(false);
  const [recents, setRecents] = useState(readRecents);
  // While a button is held past the click threshold, `charge` drives the
  // button's grow/glow indicator: { glyph, level (0..1) } or null.
  const [charge, setCharge] = useState(null);
  const containerRef = useRef(null);
  const rectRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef({ running: false, lastT: 0 });
  const channelRef = useRef(null);
  const chargeRef = useRef(null);
  // External subscribers (e.g. the video toolbar's reaction bar) so it can
  // mirror the charge glow + recents list without this overlay re-rendering
  // it. recentsRef holds the latest list for immediate delivery on subscribe.
  const chargeSubsRef = useRef(new Set());
  const recentsSubsRef = useRef(new Set());
  const recentsRef = useRef([]);
  recentsRef.current = recents;

  // Recents are ordered by FIRST use and stay put — re-using an emoji does
  // NOT bump it to the front (which made the bar reshuffle under you). A new
  // emoji is prepended once; the queue caps at 16, dropping the oldest.
  const pushRecent = useCallback((glyph) => {
    setRecents((prev) => {
      if (prev.includes(glyph)) return prev;
      const next = [glyph, ...prev].slice(0, 16);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // ─── particle system ───
  const startLoop = useCallback(() => {
    const r = rafRef.current;
    if (r.running) return;
    r.running = true;
    r.lastT = performance.now();
    const step = (t) => {
      const r2 = rafRef.current;
      if (!r2.running) return;
      const dt = Math.min(0.05, (t - r2.lastT) / 1000 || 0);
      r2.lastT = t;
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) {
          if (p._t) clearTimeout(p._t);
          if (p.el?.parentNode) p.el.parentNode.removeChild(p.el);
          ps.splice(i, 1);
          continue;
        }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const age = p.maxLife - p.life;
        const a = Math.min(Math.min(1, age / 0.12), Math.min(1, p.life / 0.55));
        const sc = 0.5 + 0.5 * Math.min(1, age / 0.18);
        p.el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg) scale(${sc})`;
        p.el.style.opacity = a;
      }
      if (ps.length === 0) { rafRef.current.running = false; return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // Burst a particle (emoji glyph + optional name pill) at a horizontal
  // anchor `x01` (0..1 of container width). We accept a normalized x so
  // the broadcast sender can describe "from the middle button" in a way
  // that maps across peers with different viewport widths.
  const burst = useCallback((glyph, x01 = 0.5, name = "") => {
    const cont = containerRef.current;
    if (!cont || !glyph) return;
    const r = rectRef.current || cont.getBoundingClientRect();
    const ps = particlesRef.current;
    while (ps.length >= 120) {
      const old = ps.shift();
      if (old._t) clearTimeout(old._t);
      if (old.el?.parentNode) old.el.parentNode.removeChild(old.el);
    }
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:2px;will-change:transform,opacity;pointer-events:none;user-select:none;";
    const size = 24 + Math.random() * 16;
    const gly = document.createElement("span");
    gly.textContent = glyph;
    gly.style.cssText = `font-size:${size}px;line-height:1;text-shadow:0 2px 4px rgba(0,0,0,.35);`;
    el.appendChild(gly);
    if (name) {
      const lbl = document.createElement("span");
      lbl.textContent = name;
      lbl.style.cssText = "max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;color:#fff;background:rgba(15,23,42,.72);padding:1px 6px;border-radius:9999px;text-shadow:0 1px 2px rgba(0,0,0,.4);";
      el.appendChild(lbl);
    }
    cont.appendChild(el);
    const ox = x01 * r.width + (Math.random() * 28 - 14);
    const oy = r.height - 58;
    const maxLife = 1.6 + Math.random() * 0.8;
    const part = {
      el, x: ox, y: oy,
      vx: Math.random() * 70 - 35,
      vy: -(160 + Math.random() * 100),
      g: 55, rot: Math.random() * 40 - 20, vr: Math.random() * 120 - 60,
      life: maxLife, maxLife,
    };
    part._t = setTimeout(() => {
      const idx = ps.indexOf(part);
      if (idx >= 0) ps.splice(idx, 1);
      if (part.el?.parentNode) part.el.parentNode.removeChild(part.el);
    }, maxLife * 1000 + 500);
    ps.push(part);
    startLoop();
  }, [startLoop]);

  // Fountain: spawn `count` particles staggered over a few frames so a
  // charged release reads as a burst rather than one clump. Only the
  // first particle wears the name pill — N labels would be noise.
  const burstMany = useCallback((glyph, x01 = 0.5, name = "", count = 1) => {
    const n = Math.max(1, Math.min(BURST_MAX, Math.round(count)));
    let i = 0;
    const spawn = () => {
      const batch = Math.min(5, n - i);
      for (let k = 0; k < batch; k++) {
        burst(glyph, x01 + (Math.random() * 0.2 - 0.1), i === 0 && k === 0 ? name : "");
      }
      i += batch;
      if (i < n) setTimeout(spawn, 45);
    };
    spawn();
  }, [burst]);

  // ─── realtime channel ───
  useEffect(() => {
    if (!enabled || !channelKey) return;
    // Channel naming convention: "emote:<scope-key>". Same scope key
    // across surfaces shares emotes.
    const ch = supabase.channel(`emote:${channelKey}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    ch.on("broadcast", { event: "emote" }, (msg) => {
      const { key, glyph, x01, name, count } = msg.payload || {};
      // Prefer the explicit glyph; fall back to the legacy preset map so
      // emotes from a not-yet-updated peer still render.
      const g = glyph || GLYPH[key];
      if (!g) return;
      const xx = typeof x01 === "number" ? x01 : 0.5;
      const nm = typeof name === "string" ? name : "";
      if (typeof count === "number" && count > 1) burstMany(g, xx, nm, count);
      else burst(g, xx, nm);
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      try { supabase.removeChannel(ch); } catch { /* */ }
      channelRef.current = null;
    };
  }, [channelKey, enabled, burst, burstMany]);

  // Cache the container's size so burst() doesn't call getBoundingClientRect per
  // particle — that read, interleaved with the rAF loop's per-frame style
  // writes, forced a synchronous layout on every spawn and made dense
  // fountains/streams thrash. burst() only needs width/height, which change on
  // resize (not scroll), so a ResizeObserver keeps the cache fresh cheaply.
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return undefined;
    const update = () => { rectRef.current = cont.getBoundingClientRect(); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(cont);
    return () => ro.disconnect();
  }, []);

  // Clean up particles + any active charge timer on unmount.
  useEffect(() => {
    return () => {
      const c = chargeRef.current;
      if (c?.timer) clearInterval(c.timer);
      for (const p of particlesRef.current) {
        if (p._t) clearTimeout(p._t);
        if (p.el?.parentNode) p.el.parentNode.removeChild(p.el);
      }
      particlesRef.current = [];
      rafRef.current.running = false;
    };
  }, []);

  const sendEmote = useCallback((glyph, x01, key) => {
    if (!enabled || !glyph) return;
    burst(glyph, x01, myName);
    const ch = channelRef.current;
    if (ch) {
      // Fire-and-forget. If the broadcast fails (e.g. channel not
      // joined yet), the sender still saw their own particle —
      // which is the only thing they're checking for.
      try {
        ch.send({ type: "broadcast", event: "emote", payload: { glyph, key, name: myName, x01 } });
      } catch { /* */ }
    }
  }, [burst, enabled, myName]);

  // A charged fountain (or one stream chunk): render locally and
  // broadcast as ONE event with a count so peers reproduce it without N
  // messages. showName=false keeps mid-stream chunks from stacking name
  // pills on every chunk.
  const sendBurst = useCallback((glyph, x01, key, count, showName = true) => {
    if (!enabled || !glyph) return;
    const nm = showName ? myName : "";
    burstMany(glyph, x01, nm, count);
    const ch = channelRef.current;
    if (ch) {
      try {
        ch.send({ type: "broadcast", event: "emote", payload: { glyph, key, name: nm, x01, count } });
      } catch { /* */ }
    }
  }, [burstMany, enabled, myName]);

  // Pointer released: a quick tap sends one; a hold released before full
  // charge sends a fountain scaled to how far it charged. If it had
  // tipped into stream mode, the stream already played — nothing more.
  const releaseCharge = useCallback(() => {
    const c = chargeRef.current;
    if (!c) return;
    if (c.timer) clearInterval(c.timer);
    chargeRef.current = null;
    setCharge(null);
    if (c.streaming) return; // the constant stream already played while held
    const held = performance.now() - c.startT;
    if (held < CLICK_MS) {
      sendEmote(c.glyph, c.x01, c.key);
    } else {
      const level = Math.max(0, Math.min(1, (held - CLICK_MS) / (CHARGE_FULL_MS - CLICK_MS)));
      const count = Math.round(BURST_MIN + (BURST_MAX - BURST_MIN) * level);
      sendBurst(c.glyph, c.x01, c.key, count);
    }
    pushRecent(c.glyph);
  }, [sendEmote, sendBurst, pushRecent]);

  // Pointer cancelled (gesture interrupted): drop the charge, fire nothing.
  const abortCharge = useCallback(() => {
    const c = chargeRef.current;
    if (!c) return;
    if (c.timer) clearInterval(c.timer);
    chargeRef.current = null;
    setCharge(null);
  }, []);

  // Release/cancel are tracked on the window so dragging off the button
  // before letting go still resolves the charge.
  useEffect(() => {
    window.addEventListener("pointerup", releaseCharge);
    window.addEventListener("pointercancel", abortCharge);
    return () => {
      window.removeEventListener("pointerup", releaseCharge);
      window.removeEventListener("pointercancel", abortCharge);
    };
  }, [releaseCharge, abortCharge]);

  const startEmit = useCallback((glyph, ev, key) => {
    ev?.preventDefault?.();
    // Abort any in-flight charge (e.g. a second finger) before starting.
    const prev = chargeRef.current;
    if (prev?.timer) clearInterval(prev.timer);
    const cont = containerRef.current; if (!cont) return;
    const r = cont.getBoundingClientRect();
    // Vertical (right-edge) bar: anchor the fountain to the horizontal
    // center so emotes rise up the open middle of the stage instead of
    // straight through the bar. Horizontal bar: originate from the
    // pressed button.
    const x01 = vertical
      ? 0.5
      : ev?.clientX != null ? (ev.clientX - r.left) / r.width : 0.5;
    chargeRef.current = { glyph, key, x01, startT: performance.now(), streaming: false, lastStreamT: 0, timer: null };
    chargeRef.current.timer = setInterval(() => {
      const c = chargeRef.current;
      if (!c) return;
      const held = performance.now() - c.startT;
      if (held < CLICK_MS) return; // still inside the single-tap window
      if (c.streaming) {
        // Past full charge: emit a constant stream until release.
        if (held - c.lastStreamT >= STREAM_INTERVAL_MS) {
          c.lastStreamT = held;
          sendBurst(c.glyph, c.x01, c.key, STREAM_PER_TICK, false);
        }
        // Pulse the glow so the button reads as actively streaming.
        setCharge({ glyph: c.glyph, level: 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(held / 110)) });
        return;
      }
      const level = Math.max(0, Math.min(1, (held - CLICK_MS) / (CHARGE_FULL_MS - CLICK_MS)));
      setCharge({ glyph: c.glyph, level });
      if (held >= CHARGE_FULL_MS) {
        // Tip into stream mode; the first chunk carries the name pill.
        c.streaming = true;
        c.lastStreamT = held;
        pushRecent(c.glyph);
        sendBurst(c.glyph, c.x01, c.key, STREAM_PER_TICK, true);
      }
    }, 50);
  }, [vertical, sendBurst, pushRecent]);

  // Picker selection — always a single emote (no charge). EmoteBar owns the
  // picker open/close; this just sends + records.
  const pickEmote = useCallback((glyph) => {
    sendEmote(glyph, 0.5);
    pushRecent(glyph);
  }, [sendEmote, pushRecent]);

  // Push charge + recents updates to any external subscribers.
  useEffect(() => {
    chargeSubsRef.current.forEach((cb) => cb(charge));
  }, [charge]);
  useEffect(() => {
    recentsSubsRef.current.forEach((cb) => cb(recents));
  }, [recents]);

  // Let a caller (e.g. the video toolbar's <EmoteBar>) render the shared bar
  // and drive sends — including the hold-to-charge burst via startEmit —
  // while this overlay keeps owning the channel, particle fountain, recents,
  // and the global pointerup that resolves a charge.
  useImperativeHandle(ref, () => ({
    start: startEmit,
    pick: pickEmote,
    subscribeCharge: (cb) => {
      const s = chargeSubsRef.current;
      s.add(cb);
      return () => s.delete(cb);
    },
    subscribeRecents: (cb) => {
      const s = recentsSubsRef.current;
      s.add(cb);
      cb(recentsRef.current); // deliver current immediately
      return () => s.delete(cb);
    },
  }), [startEmit, pickEmote]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 60, overflow: "hidden" }}
    >
      {barPosition !== "hidden" && enabled && vertical && (
        // Video overlay: a compact toggle pinned to the bottom-right
        // corner so it fits even the small PiP. Tap to pop the reactions
        // out upward as a vertical column; tap again to tuck them away.
        <div className="absolute right-2 bottom-2 flex flex-col items-center gap-1 pointer-events-auto">
          {barOpen && (
            <EmoteBar
              orientation="column"
              btn={32}
              recents={recents}
              charge={charge}
              onEmit={startEmit}
              onPick={pickEmote}
              dark={dark}
            />
          )}
          <button
            type="button"
            onClick={() => setBarOpen((v) => !v)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:text-white shrink-0"
            style={{ background: "#0f172a", boxShadow: "0 16px 36px -12px rgba(0,0,0,.5)" }}
            title={barOpen ? "Hide reactions" : "Send a reaction"}
            aria-label={barOpen ? "Hide reactions" : "Send a reaction"}
            aria-expanded={barOpen}
          >
            {barOpen ? <X className="w-4 h-4" /> : <Smile className="w-5 h-5" />}
          </button>
        </div>
      )}

      {barPosition !== "hidden" && enabled && !vertical && (
        // Whiteboard: always-visible horizontal bar (plenty of room). `bottom`
        // lifts by barOffset so it can clear another bottom-centre toolbar.
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
          style={{ bottom: 12 + barOffset, transition: "bottom .18s ease" }}
        >
          <EmoteBar
            orientation="row"
            btn={40}
            recents={recents}
            charge={charge}
            onEmit={startEmit}
            onPick={pickEmote}
            dark={dark}
          />
        </div>
      )}
    </div>
  );
});

export default EmoteOverlay;
