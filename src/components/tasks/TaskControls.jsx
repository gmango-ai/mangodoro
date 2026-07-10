import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Target } from "lucide-react";
import { statusMeta, TASK_STATUSES } from "../../lib/tasks/model";
import "./tasks-ocean.css"; // ensures the --o-* tokens load wherever these controls are used

// Shared quick-view task controls, reused across every surface (Tasks timeline,
// room widget, calendar) so tasks look and behave the same everywhere. Render
// inside a `.tl-scope` (or `.tl-ocean`) so the --o-* tokens resolve; the status
// dropdown portals itself into a `.tl-scope` already.

// Focus toggle — a mango "target" that marks the task as your current focus (the
// pomodoro focus). A round target icon (not a square checkbox) so it clearly
// reads as "focus", not "done": dashed ring when idle, solid glowing mango when
// focused. One focused task at a time (setFocus clears the rest).
export function FocusCheckbox({ focused, onToggle, size = 22 }) {
  return (
    <button className="tl-scope" data-tour="task-focus" onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={focused ? "Focusing — click to clear" : "Set as focus"} aria-label={focused ? "Clear focus" : "Set as focus"}
      style={{
        width: size, height: size, marginTop: 1, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 999, cursor: "pointer",
        border: focused ? "none" : "1.5px dashed var(--o-border-strong)",
        background: focused ? "var(--o-mango-500)" : "transparent",
        color: focused ? "#fff" : "var(--o-ink-400)",
        boxShadow: focused ? "var(--o-glow-mango)" : "none",
        transition: "background .14s var(--o-ease-out), color .14s var(--o-ease-out)",
      }}>
      <Target style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2.4} />
    </button>
  );
}

// Status tracker — a labeled pill with a dropdown caret (To do / In progress /
// Done), colored by status, so it clearly reads as "set the status". `compact`
// drops the label to just the dot+caret for tight spaces (e.g. the room widget).
export function StatusControl({ status, onChange, compact = false }) {
  const [menu, setMenu] = useState(null);
  const meta = statusMeta(status);
  const open = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.max(8, r.right - 152), y: r.bottom + 4 });
  };
  return (
    <div className="tl-scope" onClick={(e) => e.stopPropagation()} style={{ flex: "none", display: "inline-flex" }}>
      <button onClick={open} data-tour="task-status" title={`Status: ${meta.label} — change`} aria-label={`Status: ${meta.label}. Change status`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: compact ? "3px 5px" : "3px 6px 3px 8px", borderRadius: 999, border: `1px solid ${meta.border}`, background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 700, cursor: "pointer", lineHeight: 1, whiteSpace: "nowrap" }}>
        <span style={{ width: 7, height: 7, borderRadius: status === "done" ? 2 : 999, background: meta.color, flex: "none" }} />
        {!compact && meta.label}
        <ChevronDown style={{ width: 12, height: 12, opacity: 0.7 }} />
      </button>
      {menu && createPortal(
        <div className="tl-scope">
          <div style={{ position: "fixed", inset: 0, zIndex: 220 }} onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
          <div style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 221, minWidth: 152, background: "var(--o-glass-strong)", backdropFilter: "var(--o-blur)", WebkitBackdropFilter: "var(--o-blur)", border: "1px solid var(--o-glass-border)", borderRadius: "var(--o-radius-md)", boxShadow: "var(--o-shadow-xl)", padding: 4 }} onClick={(e) => e.stopPropagation()}>
            {TASK_STATUSES.map((s) => (
              <button key={s.value} onClick={(e) => { e.stopPropagation(); onChange(s.value); setMenu(null); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 9px", border: "none", background: status === s.value ? "var(--o-sand-100)" : "none", borderRadius: 8, cursor: "pointer", textAlign: "left", fontSize: 12.5, fontWeight: 600, color: "var(--o-ink-700)" }}>
                <span style={{ width: 10, height: 10, borderRadius: s.value === "done" ? 3 : 999, background: s.color, flex: "none" }} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {status === s.value && <Check style={{ width: 13, height: 13, color: "var(--o-ink-500)" }} />}
              </button>
            ))}
          </div>
        </div>, document.body)}
    </div>
  );
}
