import { useEffect, useRef, useState } from "react";
import { ViewportPortal, useViewport, Panel } from "@xyflow/react";

// Remote cursors arrive throttled (~45ms) so rendering them raw makes them
// jump. We ease each cursor toward its latest target every animation frame
// (exponential smoothing) with a small velocity lead so it tracks motion
// without lagging — and write the transform to the DOM directly so a moving
// cursor never re-renders React. Positions are in FLOW space and counter-
// scaled by zoom so cursors stay a constant on-screen size (FigJam style).

const SMOOTH = 0.32;   // 0..1 — higher snaps faster, lower glides more
const LEAD = 0.6;      // how far to project along recent velocity
const LEAD_CLAMP = 36; // cap the lead so fast flicks don't overshoot

export function CollabCursors({ peers }) {
  const { zoom } = useViewport();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const targets = useRef({});   // id → { x, y, vx, vy, name, color }
  const anim = useRef({});      // id → { x, y } (rendered, smoothed)
  const els = useRef({});       // id → DOM node
  const [ids, setIds] = useState([]);
  const idsKey = useRef("");

  // Fold incoming peer positions into targets + velocity estimates.
  useEffect(() => {
    const next = peers || {};
    const keys = Object.keys(next);
    for (const id of keys) {
      const prev = targets.current[id];
      const p = next[id];
      const vx = prev ? p.x - prev.x : 0;
      const vy = prev ? p.y - prev.y : 0;
      targets.current[id] = {
        x: p.x, y: p.y, name: p.name, color: p.color,
        // smooth the velocity so a single jittery sample doesn't fling it
        vx: prev ? prev.vx * 0.5 + vx * 0.5 : 0,
        vy: prev ? prev.vy * 0.5 + vy * 0.5 : 0,
      };
      if (!anim.current[id]) anim.current[id] = { x: p.x, y: p.y };
    }
    for (const id of Object.keys(targets.current)) {
      if (!next[id]) { delete targets.current[id]; delete anim.current[id]; }
    }
    const key = keys.slice().sort().join(",");
    if (key !== idsKey.current) { idsKey.current = key; setIds(keys); }
  }, [peers]);

  // One rAF loop drives every cursor's transform imperatively.
  useEffect(() => {
    let raf;
    const tick = () => {
      const s = 1 / (zoomRef.current || 1);
      for (const id of Object.keys(targets.current)) {
        const t = targets.current[id];
        const a = anim.current[id] || (anim.current[id] = { x: t.x, y: t.y });
        const lx = Math.max(-LEAD_CLAMP, Math.min(LEAD_CLAMP, t.vx * LEAD));
        const ly = Math.max(-LEAD_CLAMP, Math.min(LEAD_CLAMP, t.vy * LEAD));
        a.x += (t.x + lx - a.x) * SMOOTH;
        a.y += (t.y + ly - a.y) * SMOOTH;
        const el = els.current[id];
        if (el) el.style.transform = `translate(${a.x}px, ${a.y}px) scale(${s})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <ViewportPortal>
      {ids.map((id) => {
        const p = targets.current[id] || { color: "#64748b" };
        return (
          <div
            key={id}
            ref={(el) => { if (el) els.current[id] = el; else delete els.current[id]; }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "0 0",
              pointerEvents: "none",
              zIndex: 1000,
              willChange: "transform",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" style={{ display: "block", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.35))" }}>
              <path d="M5 3 L19.5 11.5 L12.5 12.8 L9.4 19.6 Z" fill={p.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {p.name && (
              <div
                style={{
                  marginLeft: 15,
                  marginTop: -6,
                  background: p.color,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 7,
                  whiteSpace: "nowrap",
                  boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                }}
              >
                {p.name}
              </div>
            )}
          </div>
        );
      })}
    </ViewportPortal>
  );
}

// Stacked avatars of everyone else currently on the board.
export function PresenceStack({ members, dark }) {
  if (!members?.length) return null;
  const shown = members.slice(0, 6);
  const extra = members.length - shown.length;
  return (
    <Panel position="top-right" className="flex items-center pointer-events-none">
      <div className="flex items-center -space-x-2">
        {shown.map((m) => (
          <div
            key={m.id}
            title={m.name || "Guest"}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold border-2 ${dark ? "border-[var(--color-surface)]" : "border-white"}`}
            style={{ background: m.color || "#64748b" }}
          >
            {(m.name || "?").trim().charAt(0).toUpperCase() || "?"}
          </div>
        ))}
        {extra > 0 && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${dark ? "border-[var(--color-surface)] bg-slate-600 text-white" : "border-white bg-slate-200 text-slate-600"}`}>
            +{extra}
          </div>
        )}
      </div>
    </Panel>
  );
}
