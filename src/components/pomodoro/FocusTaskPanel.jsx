import { useCallback, useEffect, useState } from "react";
import { Check, Radio, SquarePen, ChevronDown, Target } from "lucide-react";
import { supabase } from "../../supabase";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { setSubtaskDone, subtaskProgress } from "../../lib/subtasks";
import { fetchFocusedTask, syncPlannerProgressFromSubtasks } from "../../lib/plannerTasks";
import { applyStatusOverride } from "../../lib/statusActions";
import { normalizeTask } from "../../lib/tasks/model";
import { setFocus } from "../../lib/tasks/mutations";
import { fetchOpenPlannerTasks } from "../../lib/calendar";
import TaskDetailSheet from "../tasks/TaskDetailSheet";

// Shows the user's currently focused (in_progress) planner task inside the
// pomodoro surface so its subtasks can be checked off mid-session, offers a
// one-click "Set as status", and lets you pick / change the focus task right
// from the timer (Choose / Change → task picker).
export default function FocusTaskPanel() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session, updateStatus } = useApp();
  const userId = session?.user?.id;

  const [task, setTask] = useState(null);
  const [subs, setSubs] = useState([]);
  const [statusSet, setStatusSet] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);

  const refresh = useCallback(async () => {
    if (!userId) { setTask(null); setSubs([]); return; }
    const { task: t, subtasks } = await fetchFocusedTask(userId);
    setTask(t);
    setSubs(subtasks);
  }, [userId]);

  // Pick / change the focus task from the timer.
  const togglePicker = useCallback(async () => {
    if (pickerOpen) { setPickerOpen(false); return; }
    const { data } = await fetchOpenPlannerTasks(userId, 40);
    setCandidates(data || []);
    setPickerOpen(true);
  }, [pickerOpen, userId]);
  const pickFocus = useCallback(async (row) => {
    setPickerOpen(false);
    const r = await setFocus({ userId, taskId: row.id });
    if (!r?.error) refresh();
  }, [userId, refresh]);

  // Open the shared editor on the full task row (fetchFocusedTask only selects a
  // subset), so every field is populated and editable — same editor as the
  // Tasks page and the calendar.
  const openEditor = useCallback(async () => {
    if (!task?.id) return;
    const { data } = await supabase.from("planner_tasks").select("*").eq("id", task.id).maybeSingle();
    setEditing(normalizeTask(data || { ...task, in_progress: true }, "planner"));
  }, [task]);

  useEffect(() => { refresh(); }, [refresh]);
  // Focus may have changed in the planner while this stayed mounted — re-sync
  // when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);
  useEffect(() => { setStatusSet(false); }, [task?.id]);

  if (!userId) return null; // local / logged-out timer has no planner tasks

  const prog = subtaskProgress(subs);
  const pickerBtnCls = `inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
    dark ? "bg-[var(--color-surface)] text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
  }`;

  const toggleSub = async (s) => {
    const next = subs.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x));
    setSubs(next); // optimistic
    const { error } = await setSubtaskDone(s.id, !s.done);
    if (error) { setSubs(subs); return; }
    await syncPlannerProgressFromSubtasks({ userId, taskId: task.id });
  };

  const setAsStatus = () => {
    applyStatusOverride({
      availability: "focusing",
      message: task.title,
      userId,
      updateStatus,
    });
    setStatusSet(true);
  };

  return (
    <>
    <div data-tour="pomodoro-focus-task" className={`rounded-xl border p-3 space-y-2 ${dark ? "bg-[var(--color-surface-raised)]/40 border-[var(--color-border)]" : "bg-slate-50 border-slate-200"}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>Focus task</span>
        {task && prog.total > 0 && (
          <span className={`text-[10px] tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>{prog.done}/{prog.total} · {prog.pct}%</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {task && (
            <button type="button" onClick={setAsStatus} title="Set your status to this task"
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                statusSet ? (dark ? "text-emerald-300" : "text-emerald-700")
                  : dark ? "bg-[var(--color-surface)] text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
              {statusSet ? <><Check className="w-3 h-3" /> Status set</> : <><Radio className="w-3 h-3" /> Set as status</>}
            </button>
          )}
          {task && (
            <button type="button" onClick={openEditor} title="Open task" aria-label="Open task in the editor"
              className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${dark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
              <SquarePen className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" onClick={togglePicker} className={pickerBtnCls} title={task ? "Change focus task" : "Choose a focus task"}>
            {task ? "Change" : "Choose"} <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>

      {task ? (
        <button type="button" onClick={openEditor} className="block w-full text-left">
          <p className={`text-sm font-medium leading-snug hover:underline ${dark ? "text-slate-100" : "text-slate-900"}`}>{task.title}</p>
        </button>
      ) : (
        <p className={`text-xs leading-snug ${dark ? "text-slate-400" : "text-slate-500"}`}>No focus task yet — choose one to track it here during your session.</p>
      )}

      {pickerOpen && (
        <div className={`rounded-lg border overflow-hidden ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <div className={`max-h-56 overflow-y-auto py-1`}>
            {candidates.length === 0 ? (
              <p className={`text-xs px-3 py-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>No open tasks to focus.</p>
            ) : candidates.map((c) => (
              <button key={c.id} type="button" onClick={() => pickFocus(c)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${dark ? "hover:bg-slate-700 text-slate-200" : "hover:bg-slate-100 text-slate-700"}`}>
                <Target className={`w-3.5 h-3.5 shrink-0 ${c.id === task?.id ? "text-[var(--color-accent)]" : dark ? "text-slate-500" : "text-slate-400"}`} />
                <span className="flex-1 min-w-0 truncate">{(c.title || "").trim()}</span>
                {c.id === task?.id && <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {task && prog.total > 0 && (
        <>
          <div className={`h-1.5 rounded-full overflow-hidden ${dark ? "bg-slate-700/60" : "bg-slate-200"}`}>
            <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${prog.pct}%` }} />
          </div>
          <ul className="space-y-1 pt-0.5">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleSub(s)}
                  aria-label={s.done ? "Mark subtask not done" : "Mark subtask done"}
                  className={
                    s.done
                      ? "shrink-0 w-4 h-4 rounded border flex items-center justify-center bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                      : `shrink-0 w-4 h-4 rounded border ${dark ? "border-[var(--color-border)]" : "border-slate-300"}`
                  }
                >
                  {s.done && <Check className="w-3 h-3" />}
                </button>
                <span className={`text-xs ${s.done ? `line-through ${dark ? "text-slate-500" : "text-slate-400"}` : dark ? "text-slate-200" : "text-slate-700"}`}>
                  {s.title}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
    {editing && (
      <TaskDetailSheet
        task={editing}
        onClose={() => { setEditing(null); refresh(); }}
        onDeleted={() => { setEditing(null); refresh(); }}
      />
    )}
    </>
  );
}
