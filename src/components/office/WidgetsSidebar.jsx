import { useState } from "react";
import { ClipboardList, Search, Target, X as XIcon } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import { unlinkRetroFromSession } from "../../lib/syncSession";
import { useWidgetOrder } from "../../hooks/useWidgetOrder";
import RetroPicker from "./RetroPicker";
import TimerWidget from "./TimerWidget";
import PomodoroWidget from "./PomodoroWidget";
import GoalsWidget from "./GoalsWidget";
import RoomMembersWidget from "./RoomMembersWidget";
import WidgetSection, { DragHandleProvider } from "./WidgetSection";

// App-wide widgets sidebar. Each widget is a WidgetSection so it can
// collapse independently (state persisted per-widget). Widgets can
// also be reordered by dragging the grip handle in the header —
// useWidgetOrder persists the user's chosen order across reloads,
// reconciling against the default list when widgets get added or
// removed by future PRs.
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

  // Lookup table keyed by widget id. Each entry is a render function
  // so an id with no entry (stale localStorage from a removed widget)
  // is harmlessly skipped.
  const widgetById = {
    timer:        () => <TimerWidget dark={dark} />,
    pomodoro:     () => <PomodoroWidget dark={dark} />,
    "room-members": () => <RoomMembersWidget dark={dark} />,
    goals:        () => <GoalsWidget dark={dark} />,
    retro:        () => <RetroWidget dark={dark} />,
    tasks:        () => <TasksWidget dark={dark} />,
  };

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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {order.map((id) => {
            const render = widgetById[id];
            if (!render) return null;
            return (
              <SortableSlot key={id} id={id}>
                {render()}
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

// Retro link picker. WidgetSection owns the chrome + drag handle.
function RetroWidget({ dark }) {
  const { session } = useApp();
  const { syncSession, leaderPresent } = useSyncSession();
  const [pickerOpen, setPickerOpen] = useState(false);

  const userId = session?.user?.id;
  const inSession = !!syncSession;
  const linkedRetroId = inSession ? (syncSession.retro_id || null) : null;
  const isLeader = inSession && syncSession.leader_id === userId;
  // Host away (no fresh heartbeat) → any present member can attach a
  // retro, so the group isn't blocked from starting one. Mirrors the
  // server's claim_session_lead fallback.
  const canLead = inSession && (isLeader || !leaderPresent);

  async function unlink() {
    if (!syncSession?.id) return;
    await unlinkRetroFromSession(syncSession.id);
  }

  return (
    <WidgetSection id="retro" icon={Target} title="Retro" dark={dark}>
      {!inSession && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Join a session to attach a retro everyone can see.
        </p>
      )}

      {inSession && !linkedRetroId && canLead && (
        <Button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full justify-start"
          size="sm"
        >
          <Target className="w-3.5 h-3.5 mr-2" />
          Start a retro
        </Button>
      )}

      {inSession && !linkedRetroId && !canLead && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          The host can attach a retro for the group.
        </p>
      )}

      {linkedRetroId && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold w-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <Target className="w-3 h-3" fill="currentColor" />
            <span className="truncate flex-1">Retro attached</span>
            {canLead && (
              <button
                type="button"
                onClick={unlink}
                aria-label="Unlink retro"
                title="Unlink retro"
                className="p-0.5 rounded-full hover:bg-[var(--color-accent)]/15"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            Pick "Retro" in the room view-mode pill to take over the screen.
          </p>
        </div>
      )}

      <RetroPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </WidgetSection>
  );
}

function TasksWidget({ dark }) {
  return (
    <WidgetSection id="tasks" icon={ClipboardList} title="Tasks" dark={dark} defaultCollapsed>
      <div className="space-y-2">
        <div className={`relative ${
          dark ? "text-slate-500" : "text-slate-400"
        }`}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" />
          <input
            type="text"
            disabled
            placeholder="Search ClickUp tasks…"
            className={`w-full pl-8 pr-2 py-1.5 rounded-md border text-xs cursor-not-allowed ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)] placeholder:text-slate-500"
                : "bg-white border-slate-200 placeholder:text-slate-400"
            }`}
          />
        </div>
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          ClickUp integration lands next — link a task to your active session.
        </p>
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block ${
          dark ? "bg-[var(--color-surface)] text-slate-500" : "bg-white text-slate-400 border border-slate-200"
        }`}>
          Coming soon
        </span>
      </div>
    </WidgetSection>
  );
}
