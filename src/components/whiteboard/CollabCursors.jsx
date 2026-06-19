import { ViewportPortal, useViewport, Panel } from "@xyflow/react";

// Remote collaborators' cursors, drawn in FLOW space (so each cursor sits
// at the same board location for everyone) but counter-scaled by the zoom
// so they stay a constant on-screen size — FigJam style.
export function CollabCursors({ peers }) {
  const { zoom } = useViewport();
  const ids = Object.keys(peers || {});
  if (!ids.length) return null;
  const s = 1 / (zoom || 1);
  return (
    <ViewportPortal>
      {ids.map((id) => {
        const p = peers[id];
        return (
          <div
            key={id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${p.x}px, ${p.y}px) scale(${s})`,
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
