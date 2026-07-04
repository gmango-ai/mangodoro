import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Plus, Check, PenLine, X as XIcon } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { Button } from "@/components/ui/button";
import { unlinkWhiteboardFromSession } from "../../lib/syncSession";
import {
  listPersonalTasks, addPersonalTask, setPersonalTaskDone, removePersonalTask,
} from "../../lib/personalTasks";
import { useWidgetOrder } from "../../hooks/useWidgetOrder";
import WhiteboardPicker from "./WhiteboardPicker";
import PomodoroWidget from "./PomodoroWidget";
import GoalsWidget from "./GoalsWidget";
import RoomMembersWidget from "./RoomMembersWidget";
import WorldClockWidget from "./WorldClockWidget";
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
    pomodoro:     () => <PomodoroWidget dark={dark} />,
    "room-members": () => <RoomMembersWidget dark={dark} />,
    "world-clock": () => <WorldClockWidget dark={dark} />,
    goals:        () => <GoalsWidget dark={dark} />,
    whiteboard:   () => <WhiteboardWidget dark={dark} />,
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

// Whiteboard link picker. WidgetSection owns the chrome + drag handle.
// (Replaces the deprecated retro widget — the whiteboard is now what a
// room attaches for shared work.)
function WhiteboardWidget({ dark }) {
  const { syncSession } = useSyncSession();
  const { rooms, isAdmin } = useTeam();
  const { session } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);

  const inSession = !!syncSession;
  const linkedId = inSession ? (syncSession.whiteboard_id || null) : null;
  // Anyone in the room may attach/swap the shared whiteboard (a shared surface,
  // like opening a shared doc) — the server gates on session participation, not
  // leadership. EXCEPT when a manager has locked the board for this room: then
  // only managers can change it (server enforces; UI hides the controls).
  const room = syncSession?.room_id ? rooms?.find((r) => r.id === syncSession.room_id) : null;
  const locked = room?.whiteboard_locked === true;
  const canManageRoom = isAdmin || (!!room && room.created_by === session?.user?.id);
  const canLead = inSession && (!locked || canManageRoom);

  async function unlink() {
    if (!syncSession?.id) return;
    await unlinkWhiteboardFromSession(syncSession.id);
  }

  return (
    <WidgetSection id="whiteboard" icon={PenLine} title="Whiteboard" dark={dark}>
      {!inSession && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Join a session to attach a whiteboard everyone can see.
        </p>
      )}

      {inSession && !linkedId && canLead && (
        <Button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full justify-start"
          size="sm"
        >
          <PenLine className="w-3.5 h-3.5 mr-2" />
          Attach a whiteboard
        </Button>
      )}

      {inSession && !linkedId && !canLead && locked && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          A room manager has locked the whiteboard — only they can attach one here.
        </p>
      )}


      {linkedId && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold w-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <PenLine className="w-3 h-3" />
            <span className="truncate flex-1">Whiteboard attached</span>
            {canLead && (
              <button
                type="button"
                onClick={unlink}
                aria-label="Unlink whiteboard"
                title="Unlink whiteboard"
                className="p-0.5 rounded-full hover:bg-[var(--color-accent)]/15"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            Pick a "Whiteboard" layout in the room's layout menu to focus it.
          </p>
        </div>
      )}

      <WhiteboardPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </WidgetSection>
  );
}

// Simple personal task tracker. A private per-user checklist (scoped to the
// active team) — add a line, check it off, delete it. Backed by personal_tasks
// with own-rows-only RLS. Degrades to an empty list if the table isn't there
// yet (migration pending) rather than throwing.
function TasksWidget({ dark }) {
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await listPersonalTasks(activeTeamId);
    setTasks(data);
    setLoaded(true);
  }, [activeTeamId]);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    const { data, error } = await addPersonalTask({ title: t, teamId: activeTeamId });
    setSaving(false);
    if (!error && data) { setTasks((ts) => [data, ...ts]); setText(""); }
  };

  const toggle = async (task) => {
    const done = !task.done;
    setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done } : x)));
    const { error } = await setPersonalTaskDone(task.id, done);
    if (error) setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done: !done } : x)));
  };

  const remove = async (task) => {
    const prev = tasks;
    setTasks((ts) => ts.filter((x) => x.id !== task.id));
    const { error } = await removePersonalTask(task.id);
    if (error) setTasks(prev);
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const rowBtn = dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600";

  return (
    <WidgetSection id="tasks" icon={ClipboardList} title="Tasks" dark={dark}>
      <div className="space-y-2">
        {/* Add a task */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            maxLength={200}
            placeholder="Add a task…"
            className={`flex-1 min-w-0 px-2 py-1.5 rounded-md border text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
                : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
            }`}
          />
          <button
            type="button"
            onClick={add}
            disabled={!text.trim() || saving}
            aria-label="Add task"
            className="shrink-0 p-1.5 rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Open tasks */}
        {open.length > 0 && (
          <ul className="space-y-0.5">
            {open.map((task) => (
              <li key={task.id} className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(task)}
                  aria-label="Mark done"
                  className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    dark ? "border-[var(--color-border)] hover:border-[var(--color-accent)]" : "border-slate-300 hover:border-[var(--color-accent)]"
                  }`}
                />
                <span className={`flex-1 min-w-0 truncate text-xs ${dark ? "text-slate-200" : "text-slate-700"}`} title={task.title}>
                  {task.title}
                </span>
                <button
                  type="button"
                  onClick={() => remove(task)}
                  aria-label="Delete task"
                  className={`shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${rowBtn}`}
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Done tasks — struck through, dimmed, uncheck to bring back. */}
        {done.length > 0 && (
          <ul className="space-y-0.5 pt-0.5">
            {done.map((task) => (
              <li key={task.id} className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(task)}
                  aria-label="Mark not done"
                  className="shrink-0 w-4 h-4 rounded border flex items-center justify-center bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                >
                  <Check className="w-3 h-3" />
                </button>
                <span className={`flex-1 min-w-0 truncate text-xs line-through ${dark ? "text-slate-500" : "text-slate-400"}`} title={task.title}>
                  {task.title}
                </span>
                <button
                  type="button"
                  onClick={() => remove(task)}
                  aria-label="Delete task"
                  className={`shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${rowBtn}`}
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {loaded && tasks.length === 0 && (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            No tasks yet — jot down what you want to get through.
          </p>
        )}
      </div>
    </WidgetSection>
  );
}
