import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Plus, Check, PenLine, X as XIcon, ChevronRight, ChevronDown, Sparkles, Loader2 } from "lucide-react";
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
import {
  listSubtasks, addSubtask, addSubtasks, setSubtaskDone, deleteSubtask, subtaskProgress,
} from "../../lib/subtasks";
import { useWidgetOrder } from "../../hooks/useWidgetOrder";
import EmojiTextField from "../EmojiTextField";
import WhiteboardPicker from "./WhiteboardPicker";
import PomodoroWidget from "./PomodoroWidget";
import GoalsWidget from "./GoalsWidget";
import TeamStatusWidget from "./TeamStatusWidget";
import WorldClockWidget from "./WorldClockWidget";
import UpcomingMeetingsWidget from "./UpcomingMeetingsWidget";
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
    "team-status": () => <TeamStatusWidget dark={dark} />,
    "world-clock": () => <WorldClockWidget dark={dark} />,
    "upcoming-meetings": () => <UpcomingMeetingsWidget dark={dark} />,
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
  const { rooms, isAdmin, myOrgTeamLeadIds } = useTeam();
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
  const gatingTeamIds = (room?.room_teams || []).map((rt) => rt.org_team_id);
  const canManageRoom = isAdmin
    || (!!room && room.created_by === session?.user?.id)
    || gatingTeamIds.some((id) => myOrgTeamLeadIds?.has(id));
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
  const [subsByTask, setSubsByTask] = useState({});
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await listPersonalTasks(activeTeamId);
    setTasks(data);
    const ids = data.map((t) => t.id);
    if (ids.length) {
      const { byPersonal } = await listSubtasks({ personalIds: ids });
      setSubsByTask(Object.fromEntries(byPersonal));
    } else {
      setSubsByTask({});
    }
    setLoaded(true);
  }, [activeTeamId]);
  useEffect(() => { reload(); }, [reload]);

  const setSubs = (taskId, next) => setSubsByTask((m) => ({ ...m, [taskId]: next }));

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

  const addSub = async (task, title) => {
    const existing = subsByTask[task.id] || [];
    const sortOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await addSubtask({ personalTaskId: task.id, title, sortOrder });
    if (!error && data) setSubs(task.id, [...existing, data]);
  };
  const addAiSubs = async (task, titles) => {
    const existing = subsByTask[task.id] || [];
    const startOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await addSubtasks({ personalTaskId: task.id, titles, startOrder });
    if (!error && data) setSubs(task.id, [...existing, ...data].sort((a, b) => a.sort_order - b.sort_order));
  };
  const toggleSub = async (task, sub) => {
    const next = (subsByTask[task.id] || []).map((s) => (s.id === sub.id ? { ...s, done: !s.done } : s));
    setSubs(task.id, next);
    const { error } = await setSubtaskDone(sub.id, !sub.done);
    if (error) setSubs(task.id, subsByTask[task.id] || []);
  };
  const deleteSub = async (task, sub) => {
    const next = (subsByTask[task.id] || []).filter((s) => s.id !== sub.id);
    setSubs(task.id, next);
    const { error } = await deleteSubtask(sub.id);
    if (error) setSubs(task.id, subsByTask[task.id] || []);
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const rowBtn = dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600";

  const rowProps = { dark, rowBtn, onToggle: toggle, onRemove: remove, onAddSub: addSub, onAddAiSubs: addAiSubs, onToggleSub: toggleSub, onDeleteSub: deleteSub };

  return (
    <WidgetSection id="tasks" icon={ClipboardList} title="Tasks" dark={dark}>
      <div className="space-y-2">
        {/* Add a task */}
        <div className="flex items-center gap-1.5">
          <EmojiTextField
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
              <WidgetTaskRow key={task.id} task={task} subs={subsByTask[task.id]} {...rowProps} />
            ))}
          </ul>
        )}

        {/* Done tasks — struck through, dimmed, uncheck to bring back. */}
        {done.length > 0 && (
          <ul className="space-y-0.5 pt-0.5">
            {done.map((task) => (
              <WidgetTaskRow key={task.id} task={task} subs={subsByTask[task.id]} isDone {...rowProps} />
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

// One personal-task row with an expandable subtask checklist (count badge +
// check/add/delete + AI generate). No progress column here — personal_tasks
// are a plain checklist — so subtasks show a "2/5" count only.
function WidgetTaskRow({ task, subs, dark, rowBtn, isDone, onToggle, onRemove, onAddSub, onAddAiSubs, onToggleSub, onDeleteSub }) {
  const { suggestSubtasks, deepseekKey } = useApp();
  const list = subs || [];
  const { done, total } = subtaskProgress(list);
  const [expanded, setExpanded] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const submitNew = async (e) => {
    e?.preventDefault?.();
    const v = newSub.trim();
    if (!v) return;
    setNewSub("");
    await onAddSub(task, v);
    setExpanded(true);
  };
  const runAi = async () => {
    setAiBusy(true);
    try {
      const titles = await suggestSubtasks(task.title);
      if (titles?.length) { await onAddAiSubs(task, titles); setExpanded(true); }
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <li className="group">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggle(task)}
          aria-label={isDone ? "Mark not done" : "Mark done"}
          className={
            isDone
              ? "shrink-0 w-4 h-4 rounded border flex items-center justify-center bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
              : `shrink-0 w-4 h-4 rounded border flex items-center justify-center ${dark ? "border-[var(--color-border)] hover:border-[var(--color-accent)]" : "border-slate-300 hover:border-[var(--color-accent)]"}`
          }
        >
          {isDone && <Check className="w-3 h-3" />}
        </button>
        <span
          className={`flex-1 min-w-0 truncate text-xs ${isDone ? `line-through ${dark ? "text-slate-500" : "text-slate-400"}` : dark ? "text-slate-200" : "text-slate-700"}`}
          title={task.title}
        >
          {task.title}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
          className={`shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] tabular-nums ${rowBtn} ${total > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
        >
          {total > 0 && <span>{done}/{total}</span>}
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(task)}
          aria-label="Delete task"
          className={`shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${rowBtn}`}
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="ml-6 mt-1 mb-1.5 space-y-1">
          {list.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 group/sub">
              <button
                type="button"
                onClick={() => onToggleSub(task, s)}
                aria-label={s.done ? "Mark subtask not done" : "Mark subtask done"}
                className={
                  s.done
                    ? "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                    : `shrink-0 w-3.5 h-3.5 rounded border ${dark ? "border-[var(--color-border)]" : "border-slate-300"}`
                }
              >
                {s.done && <Check className="w-2.5 h-2.5" />}
              </button>
              <span className={`flex-1 min-w-0 truncate text-[11px] ${s.done ? `line-through ${dark ? "text-slate-500" : "text-slate-400"}` : dark ? "text-slate-300" : "text-slate-600"}`} title={s.title}>
                {s.title}
              </span>
              <button
                type="button"
                onClick={() => onDeleteSub(task, s)}
                aria-label="Delete subtask"
                className={`shrink-0 p-0.5 rounded opacity-0 group-hover/sub:opacity-100 transition-opacity ${rowBtn}`}
              >
                <XIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
          <form onSubmit={submitNew} className="flex items-center gap-1">
            <EmojiTextField
              type="text"
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              maxLength={200}
              placeholder="Add subtask…"
              className={`flex-1 min-w-0 px-1.5 py-1 rounded border text-[11px] outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${
                dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
              }`}
            />
            {deepseekKey && (
              <button
                type="button"
                onClick={runAi}
                disabled={aiBusy}
                aria-label="Generate subtasks with AI"
                title="Generate subtasks with AI"
                className={`shrink-0 p-1 rounded ${rowBtn} disabled:opacity-40`}
              >
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="submit"
              disabled={!newSub.trim()}
              aria-label="Add subtask"
              className="shrink-0 p-1 rounded text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
