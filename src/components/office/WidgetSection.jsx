import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const COLLAPSE_KEY_PREFIX = "ql_widget_collapsed_";

function loadCollapsed(id) {
  try { return localStorage.getItem(COLLAPSE_KEY_PREFIX + id) === "1"; }
  catch { return false; }
}
function saveCollapsed(id, v) {
  try { localStorage.setItem(COLLAPSE_KEY_PREFIX + id, v ? "1" : "0"); }
  catch { /* */ }
}

// Shared chrome for every sidebar widget — outer border, header row,
// and a collapse toggle. Per-widget collapsed state persists to
// localStorage under `ql_widget_collapsed_<id>` so each widget
// remembers independently. The clickable region is the entire header
// (chevron + icon + title) so it's a generous touch target on mobile.
//
//   id        — stable slug, used as the localStorage key
//   icon      — small lucide component
//   title     — short uppercase label
//   action    — optional element rendered on the right of the header
//                (e.g. a close X, settings cog)
//   defaultCollapsed — initial state if nothing is persisted yet
//
// Children are the body; they only render when expanded so heavy
// widgets (queries, audio elements, iframes) don't pay the cost when
// the user has collapsed them.
export default function WidgetSection({
  id,
  icon: Icon,
  title,
  dark,
  action,
  defaultCollapsed = false,
  children,
}) {
  const [collapsed, setCollapsedRaw] = useState(() => {
    const stored = (() => {
      try {
        const raw = localStorage.getItem(COLLAPSE_KEY_PREFIX + id);
        return raw === null ? null : raw === "1";
      } catch { return null; }
    })();
    return stored === null ? defaultCollapsed : stored;
  });
  const setCollapsed = (v) => { setCollapsedRaw(v); saveCollapsed(id, v); };

  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center justify-between gap-2 px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={`widget-body-${id}`}
          className={`inline-flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded transition-colors ${
            dark ? "hover:bg-[var(--color-surface)]/50" : "hover:bg-white/60"
          }`}
        >
          <Chevron className="w-3 h-3" />
          {Icon && <Icon className="w-3 h-3" />}
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {title}
          </span>
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {!collapsed && (
        <div id={`widget-body-${id}`} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

// Helper that lets parents read the current collapsed state without
// owning it. Useful for components that want to lazy-load expensive
// resources only when expanded.
export function isWidgetCollapsed(id) {
  return loadCollapsed(id);
}
