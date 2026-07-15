import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Plus, Check, X as XIcon, ChevronRight, ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { supabase } from "../../supabase";
import {
  listPersonalTasks, addPersonalTask, removePersonalTask,
} from "../../lib/personalTasks";
import { normalizeTask } from "../../lib/tasks/model";
import { setTaskStatus } from "../../lib/tasks/mutations";
import { StatusControl } from "../tasks/TaskControls";
import TaskDetailSheet from "../tasks/TaskDetailSheet";
import {
  listSubtasks, addSubtask, addSubtasks, setSubtaskDone, deleteSubtask, subtaskProgress,
} from "../../lib/subtasks";
import EmojiTextField from "../EmojiTextField";
import WidgetSection from "./WidgetSection";

// Simple personal task tracker. A private per-user checklist (scoped to the
// active team) — add a line, check it off, delete it. Backed by personal_tasks
// with own-rows-only RLS. Degrades to an empty list if the table isn't there
// yet (migration pending) rather than throwing.
export default function TasksWidget({ dark }) {
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [subsByTask, setSubsByTask] = useState({});
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  // Open the shared task editor (due date, deadline, labels — the parity the
  // inline row doesn't surface) on the full personal_tasks row.
  const openEditor = useCallback(async (task) => {
    const { data } = await supabase.from("personal_tasks").select("*").eq("id", task.id).maybeSingle();
    setEditing(normalizeTask(data || task, "personal"));
  }, []);

  const reload = useCallback(async () => {
    const { data } = await listPersonalTasks(activeTeamId);
    const live = (data || []).filter((t) => !t.archived); // archived tasks hidden from the widget
    setTasks(live);
    const ids = live.map((t) => t.id);
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

  const setStatus = async (task, status) => {
    const done = status === "done";
    setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, status, done } : x)));
    const r = await setTaskStatus({ task: { id: task.id, kind: "personal", done: task.done, status: task.status || (task.done ? "done" : "todo") }, status });
    if (r?.error) setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, status: task.status, done: task.done } : x)));
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

  const rowProps = { dark, rowBtn, onSetStatus: setStatus, onRemove: remove, onOpen: openEditor, onAddSub: addSub, onAddAiSubs: addAiSubs, onToggleSub: toggleSub, onDeleteSub: deleteSub };

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
      {editing && (
        <TaskDetailSheet
          task={editing}
          onClose={() => { setEditing(null); reload(); }}
          onDeleted={() => { setEditing(null); reload(); }}
        />
      )}
    </WidgetSection>
  );
}

// One personal-task row with an expandable subtask checklist (count badge +
// check/add/delete + AI generate). No progress column here — personal_tasks
// are a plain checklist — so subtasks show a "2/5" count only.
function WidgetTaskRow({ task, subs, dark, rowBtn, isDone, onSetStatus, onRemove, onOpen, onAddSub, onAddAiSubs, onToggleSub, onDeleteSub }) {
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
          onClick={() => onOpen?.(task)}
          className={`flex-1 min-w-0 truncate text-left text-xs hover:underline ${isDone ? `line-through ${dark ? "text-slate-500" : "text-slate-400"}` : dark ? "text-slate-200" : "text-slate-700"}`}
          title={`${task.title} — open`}
        >
          {task.title}
        </button>
        <StatusControl status={task.status || (task.done ? "done" : "todo")} onChange={(s) => onSetStatus(task, s)} compact />
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
