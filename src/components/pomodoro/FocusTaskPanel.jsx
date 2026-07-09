import { useCallback, useEffect, useState } from "react";
import { Check, Radio } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { setSubtaskDone, subtaskProgress } from "../../lib/subtasks";
import { fetchFocusedTask, syncPlannerProgressFromSubtasks } from "../../lib/plannerTasks";
import { applyStatusOverride } from "../../lib/statusActions";

// Shows the user's currently focused (in_progress) planner task inside the
// pomodoro surface so its subtasks can be checked off mid-session — and offers
// a one-click "Set as status" that routes through the unified status override
// (the concrete task ↔ status link). Self-hides when nothing is focused.
export default function FocusTaskPanel() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session, updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const userId = session?.user?.id;

  const [task, setTask] = useState(null);
  const [subs, setSubs] = useState([]);
  const [statusSet, setStatusSet] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setTask(null); setSubs([]); return; }
    const { task: t, subtasks } = await fetchFocusedTask(userId);
    setTask(t);
    setSubs(subtasks);
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);
  // Focus may have changed in the planner while this stayed mounted — re-sync
  // when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);
  useEffect(() => { setStatusSet(false); }, [task?.id]);

  if (!task) return null;

  const prog = subtaskProgress(subs);

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
      expiresAt: null,
      userId,
      syncSession,
      updateStatus,
      setStatus,
    });
    setStatusSet(true);
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${dark ? "bg-[var(--color-surface-raised)]/40 border-[var(--color-border)]" : "bg-slate-50 border-slate-200"}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>Focus task</span>
        {prog.total > 0 && (
          <span className={`text-[10px] tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>{prog.done}/{prog.total} · {prog.pct}%</span>
        )}
        <button
          type="button"
          onClick={setAsStatus}
          title="Set your status to this task"
          className={`ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
            statusSet
              ? dark ? "text-emerald-300" : "text-emerald-700"
              : dark ? "bg-[var(--color-surface)] text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
          }`}
        >
          {statusSet ? <><Check className="w-3 h-3" /> Status set</> : <><Radio className="w-3 h-3" /> Set as status</>}
        </button>
      </div>
      <p className={`text-sm font-medium leading-snug ${dark ? "text-slate-100" : "text-slate-900"}`}>{task.title}</p>
      {prog.total > 0 && (
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
  );
}
