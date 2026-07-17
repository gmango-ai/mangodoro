import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCenter,
} from "@dnd-kit/core";
import { useWidgetOrder } from "../../hooks/useWidgetOrder";
import { sidebarWidgetById } from "../../lib/widgets/registry";
import { DragHandleProvider } from "../office/WidgetSection";

// The draggable, reorderable list of full widget cards — the body of the
// app-wide WidgetDrawer (formerly the office WidgetsSidebar). Cards come from
// the shared registry; order is synced via useWidgetOrder. `ctx.inRoom` gates
// session/room-scoped widgets so they don't show as dead cards off-room.
export default function WidgetList({ dark, ctx = {} }) {
  const { order, reorder } = useWidgetOrder();

  // 5px activation distance lets the header's collapse-on-click work without the
  // drag intercepting a click; tap-and-drag still fires past that threshold.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(active.id, over.id);
  }

  const canShow = (w) => w && (w.scope === "global" || w.scope === "team" || ctx.inRoom);

  // closestCenter: rank drop targets by centre distance, not overlap area, so a
  // short collapsed widget can still win a drop over a tall expanded one.
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="h-full overflow-y-auto p-3 space-y-3">
        {order.map((id) => {
          const w = sidebarWidgetById[id];
          if (!canShow(w)) return null; // absent (stale id) or out-of-scope here
          return (
            <SortableSlot key={id} id={id}>
              {w.render({ dark })}
            </SortableSlot>
          );
        })}
      </div>
    </DndContext>
  );
}

// Per-widget drop target + drag source sharing one DOM node, so a widget can be
// both grabbed and a landing target. The grip-handle listeners are piped to
// WidgetSection via DragHandleProvider so widgets don't need to know about DnD.
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
