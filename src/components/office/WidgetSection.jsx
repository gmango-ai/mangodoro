import { createContext, useContext, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

// Context used by WidgetsSidebar's DnD layer to pipe the per-widget
// drag handle props down without each widget needing to know how it's
// being made sortable. If no provider is in scope, the grip handle
// just doesn't render and the section behaves as a static widget.
const DragHandleContext = createContext(null);
export const DragHandleProvider = DragHandleContext.Provider;

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
  // `bare` drops the section card + collapse header and just fills its parent
  // (scrolling) — used when the widget body is hosted as a room-layout tile,
  // which supplies its own title bar. See roomLayout/viewPanels.
  bare = false,
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
  const dragHandle = useContext(DragHandleContext);

  // Hosted as a room-layout tile: no card/header, just fill + scroll.
  if (bare) return <div className="h-full overflow-y-auto p-3">{children}</div>;

  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center justify-between gap-2 px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {dragHandle && (
            <button
              type="button"
              {...dragHandle.listeners}
              {...dragHandle.attributes}
              aria-label="Drag to reorder"
              title="Drag to reorder"
              className={`p-0.5 -ml-1 rounded cursor-grab active:cursor-grabbing transition-colors ${
                dark ? "text-slate-600 hover:text-slate-300" : "text-slate-300 hover:text-slate-500"
              }`}
            >
              <GripVertical className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls={`widget-body-${id}`}
            className={`inline-flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors min-w-0 ${
              dark ? "hover:bg-[var(--color-surface)]/50" : "hover:bg-white/60"
            }`}
          >
            <Chevron className="w-3 h-3 shrink-0" />
            {Icon && <Icon className="w-3 h-3 shrink-0" />}
            <span className="text-[10px] font-bold uppercase tracking-wider truncate">
              {title}
            </span>
          </button>
        </div>
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
