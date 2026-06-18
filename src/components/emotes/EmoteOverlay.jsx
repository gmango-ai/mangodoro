import { useCallback, useEffect, useRef } from "react";
import { supabase } from "../../supabase";

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
//   * Particles are a single rAF loop with a pooled DOM cap (220 max,
//     FIFO recycle) and a setTimeout backstop in case the tab is
//     hidden and rAF is throttled. No leaks under spam.
//
// The bar is render-prop'd via `barPosition` so callers can mount it
// at the bottom of a video stage, in a whiteboard toolbar, etc.

const EMOTES = [
  { key: "like",  glyph: "👍", color: "#f97316" },
  { key: "love",  glyph: "❤️", color: "#ef4444" },
  { key: "party", glyph: "🎉", color: "#8b5cf6" },
  { key: "fire",  glyph: "🔥", color: "#f59e0b" },
  { key: "clap",  glyph: "👏", color: "#facc15" },
  { key: "smile", glyph: "😊", color: "#10b981" },
];
const GLYPH = Object.fromEntries(EMOTES.map((e) => [e.key, e.glyph]));

export default function EmoteOverlay({
  channelKey,
  // "bottom-center" (default) renders an absolute bar at the bottom
  // of the relatively-positioned container we live inside. "hidden"
  // suppresses the bar entirely — useful when the caller wants its
  // own UI but still wants peers' particles to render.
  barPosition = "bottom-center",
  enabled = true,
}) {
  const containerRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef({ running: false, lastT: 0 });
  const channelRef = useRef(null);
  const holdRef = useRef(null);

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

  // Burst a particle at a horizontal anchor `x01` (0..1 of container
  // width). We accept a normalized x so the broadcast sender can
  // describe "from the middle button" in a way that maps across
  // peers with different viewport widths.
  const burst = useCallback((key, x01 = 0.5) => {
    const cont = containerRef.current;
    if (!cont) return;
    const glyph = GLYPH[key];
    if (!glyph) return;
    const r = cont.getBoundingClientRect();
    const ps = particlesRef.current;
    while (ps.length >= 220) {
      const old = ps.shift();
      if (old._t) clearTimeout(old._t);
      if (old.el?.parentNode) old.el.parentNode.removeChild(old.el);
    }
    const el = document.createElement("span");
    const size = 24 + Math.random() * 16;
    el.textContent = glyph;
    el.style.cssText = `position:absolute;left:0;top:0;font-size:${size}px;line-height:1;will-change:transform,opacity;filter:drop-shadow(0 3px 6px rgba(0,0,0,.25));pointer-events:none;user-select:none;`;
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

  // ─── realtime channel ───
  useEffect(() => {
    if (!enabled || !channelKey) return;
    // Channel naming convention: "emote:<scope-key>". Same scope key
    // across surfaces shares emotes.
    const ch = supabase.channel(`emote:${channelKey}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    ch.on("broadcast", { event: "emote" }, (msg) => {
      const { key, x01 } = msg.payload || {};
      if (!key) return;
      burst(key, typeof x01 === "number" ? x01 : 0.5);
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      try { supabase.removeChannel(ch); } catch { /* */ }
      channelRef.current = null;
    };
  }, [channelKey, enabled, burst]);

  // ─── click + hold ───
  // Single click = single burst. Hold = rapid fire (~80ms cadence)
  // until the global pointerup fires. The hold ref is cleared on any
  // pointerup so we don't leak intervals when the user drags off.
  useEffect(() => {
    function stopHold() {
      if (holdRef.current) {
        clearInterval(holdRef.current.timer);
        holdRef.current = null;
      }
    }
    window.addEventListener("pointerup", stopHold);
    window.addEventListener("pointercancel", stopHold);
    return () => {
      window.removeEventListener("pointerup", stopHold);
      window.removeEventListener("pointercancel", stopHold);
      stopHold();
      // Clean up in-flight particles on unmount.
      for (const p of particlesRef.current) {
        if (p._t) clearTimeout(p._t);
        if (p.el?.parentNode) p.el.parentNode.removeChild(p.el);
      }
      particlesRef.current = [];
      rafRef.current.running = false;
    };
  }, []);

  const sendEmote = useCallback((key, x01) => {
    if (!enabled) return;
    burst(key, x01);
    const ch = channelRef.current;
    if (ch) {
      // Fire-and-forget. If the broadcast fails (e.g. channel not
      // joined yet), the sender still saw their own particle —
      // which is the only thing they're checking for.
      try {
        ch.send({ type: "broadcast", event: "emote", payload: { key, x01 } });
      } catch { /* */ }
    }
  }, [burst, enabled]);

  const startEmit = useCallback((key, ev) => {
    ev?.preventDefault?.();
    if (holdRef.current) {
      clearInterval(holdRef.current.timer);
      holdRef.current = null;
    }
    const cont = containerRef.current; if (!cont) return;
    const r = cont.getBoundingClientRect();
    const x01 = ev?.clientX != null ? (ev.clientX - r.left) / r.width : 0.5;
    sendEmote(key, x01);
    holdRef.current = {
      timer: setInterval(() => {
        sendEmote(key, x01 + (Math.random() * 0.04 - 0.02));
      }, 80),
    };
  }, [sendEmote]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 60, overflow: "hidden" }}
    >
      {barPosition !== "hidden" && enabled && (
        <div
          className="absolute left-1/2 bottom-3 -translate-x-1/2 flex items-center gap-0.5 p-1.5 rounded-full pointer-events-auto"
          style={{
            background: "#0f172a",
            boxShadow: "0 16px 36px -12px rgba(0,0,0,.5)",
          }}
        >
          {EMOTES.map((emo) => (
            <button
              key={emo.key}
              type="button"
              onPointerDown={(e) => startEmit(emo.key, e)}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/15 transition-transform"
              title={emo.key}
              aria-label={`Send ${emo.key} emote`}
              style={{ fontSize: 22 }}
            >
              <span>{emo.glyph}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
