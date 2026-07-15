import { useTheme } from "../../context/ThemeContext";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCenter,
} from "@dnd-kit/core";
import { useWidgetOrder } from "../../hooks/useWidgetOrder";
import { sidebarWidgetById } from "../../lib/widgets/registry";
import { DragHandleProvider } from "./WidgetSection";

// App-wide widgets sidebar. Each widget is a WidgetSection so it can
// collapse independently (state persisted per-widget). Widgets can
// also be reordered by dragging the grip handle in the header —
// useWidgetOrder persists the user's chosen order across reloads,
// reconciling against the default list when widgets get added or
// removed by future PRs.
//
// The widget bodies live in the shared registry (src/lib/widgets/registry),
// which the room BSP tiles also read — one catalog, two surfaces.
export default function WidgetsSidebar() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { order, reorder } = useWidgetOrder();

  // 5px activation distance lets the header's collapse-on-click work
  // without the drag intercepting a click. Tap-and-drag still fires
  // for any pointer movement past that threshold.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(active.id, over.id);
  }

  return (
    <aside
      className={`flex flex-col h-full border-r min-w-[18rem] ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      <div className={`px-3 py-3 border-b ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      }`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${
          dark ? "text-slate-500" : "text-slate-400"
        }`}>
          Widgets
        </p>
      </div>

      {/* closestCenter: rank drop targets by centre distance, NOT overlap area.
          rectIntersection (the default) ranks by intersecting area, which is
          dominated by tall (expanded) widgets — so a short collapsed widget
          could rarely "win" a drop over an open one, making reorders only work
          between widgets in the same collapsed/expanded state. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {order.map((id) => {
            // An id with no registry entry (stale localStorage from a removed
            // widget) is harmlessly skipped.
            const render = sidebarWidgetById[id];
            if (!render) return null;
            return (
              <SortableSlot key={id} id={id}>
                {render({ dark })}
              </SortableSlot>
            );
          })}
        </div>
      </DndContext>
    </aside>
  );
}

// Per-widget drop target + drag source. The drop ref and drag ref
// share the same DOM node so a widget can be both grabbed and a
// landing target. The grip-handle listeners are piped to WidgetSection
// via DragHandleProvider so widgets don't need to know about DnD.
function SortableSlot({ id, children }) {
  const draggable = useDraggable({ id });
  const droppable = useDroppable({ id });

  function setRef(el) {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  }

  const style = draggable.transform
    ? {
        transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`,
        zIndex: draggable.isDragging ? 20 : "auto",
        opacity: draggable.isDragging ? 0.95 : 1,
      }
    : undefined;

  return (
    <div
      ref={setRef}
      style={style}
      className={`transition-colors ${
        droppable.isOver && !draggable.isDragging
          ? "outline outline-2 outline-[var(--color-accent)] rounded-xl"
          : ""
      }`}
    >
      <DragHandleProvider value={{ listeners: draggable.listeners, attributes: draggable.attributes }}>
        {children}
      </DragHandleProvider>
    </div>
  );
}
