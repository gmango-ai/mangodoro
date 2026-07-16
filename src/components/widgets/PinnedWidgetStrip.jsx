import { useRef, useState } from "react";
import { Plus, Check, Pin } from "lucide-react";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, closestCenter,
} from "@dnd-kit/core";
import { useApp } from "../../context/AppContext";
import Popover from "../goals/Popover";
import { widgetById, chipWidgets, DEFAULT_PINNED } from "../../lib/widgets/registry";

// A widget is showable in the strip if it has a chip and its scope fits the
// current context: global/team widgets show anywhere; session/room widgets only
// when we're actually in a room. (No chip-capable widget is session/room-scoped
// today, so this is forward-looking.)
function canShow(w, ctx) {
  if (!w?.chip) return false;
  if (w.scope === "global" || w.scope === "team") return true;
  return !!ctx.inRoom;
}

// The pinned-widget strip that lives in the nav's second row. Renders the user's
// pinned widgets as one-line chips (each opens its own popover) plus a "+" menu
// to pin/unpin any chip-capable widget. The pinned set syncs to the account via
// settings.widget_prefs.pinned, defaulting to DEFAULT_PINNED.
export default function PinnedWidgetStrip({ dark, ctx = {} }) {
  const { settings, mergeWidgetPrefs } = useApp();
  const pinnedRaw = settings?.widget_prefs?.pinned;
  const pinned = Array.isArray(pinnedRaw) ? pinnedRaw : DEFAULT_PINNED;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // 6px activation so a tap still opens a chip's own popover; a drag past that
  // reorders (same click-vs-drag trick as the widget drawer's list).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const shown = pinned.map((id) => widgetById[id]).filter((w) => canShow(w, ctx));
  const pinnable = chipWidgets.filter((w) => canShow(w, ctx));

  const toggle = (id) => {
    const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    mergeWidgetPrefs({ pinned: next });
  };

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = pinned.indexOf(active.id);
    const to = pinned.indexOf(over.id);
    if (from === -1 || to === -1) return;
    const next = pinned.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    mergeWidgetPrefs({ pinned: next });
  }

  return (
    <div className="flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-none">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex items-center gap-2">
          {shown.map((w) => (
            <SortableChip key={w.id} id={w.id}>{w.chip({ dark })}</SortableChip>
          ))}
        </div>
      </DndContext>

      <button
        ref={menuRef}
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        title="Pin a widget"
        aria-label="Pin a widget"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed transition-colors ${
          dark ? "border-[var(--color-border)] text-slate-500 hover:text-slate-300 hover:border-slate-500" : "border-slate-300 text-slate-400 hover:text-slate-600 hover:border-slate-400"
        }`}
      >
        <Plus className="w-4 h-4" />
      </button>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} width={220} dark={dark}>
        <p className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
          <Pin className="w-3 h-3" /> Pin to strip
        </p>
        <ul>
          {pinnable.map((w) => {
            const on = pinned.includes(w.id);
            const Icon = w.icon;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => toggle(w.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${
                    dark ? "hover:bg-white/5 text-slate-200" : "hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${on ? "text-[var(--color-accent)]" : dark ? "text-slate-400" : "text-slate-400"}`} />}
                  <span className="flex-1 min-w-0 truncate">{w.title}</span>
                  {on && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}

// One reorderable chip: the whole pill is the drag handle (these chips have no
// natural grip), sharing one node as both drag source and drop target. The 6px
// sensor threshold keeps ordinary taps (which open the chip's popover) working.
function SortableChip({ id, children }) {
  const draggable = useDraggable({ id });
  const droppable = useDroppable({ id });
  const setRef = (el) => { draggable.setNodeRef(el); droppable.setNodeRef(el); };
  const style = draggable.transform
    ? {
        transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`,
        zIndex: draggable.isDragging ? 30 : "auto",
        opacity: draggable.isDragging ? 0.9 : 1,
      }
    : undefined;
  return (
    <span
      ref={setRef}
      style={style}
      {...draggable.listeners}
      {...draggable.attributes}
      className={`shrink-0 rounded-full touch-none ${
        droppable.isOver && !draggable.isDragging ? "ring-2 ring-[var(--color-accent)]" : ""
      }`}
    >
      {children}
    </span>
  );
}
