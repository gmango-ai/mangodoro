import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getTaskProviders } from "../lib/tasks/providers";
import * as taskMutations from "../lib/tasks/mutations";
import { fetchSubtaskCounts, fetchSubtasks } from "../lib/subtasks";
import { TASK_LABELS } from "../lib/tasks/model";
import TaskTimeline from "../components/tasks/TaskTimeline";
import FocusBanner from "../components/tasks/FocusBanner";
import TaskDetailSheet from "../components/tasks/TaskDetailSheet";
import "../components/tasks/tasks-ocean.css";

// The Tasks overview — a due-date timeline that replaces the old planner as the
// primary tasks surface. Reads through the provider seam (local today, ClickUp
// later) and edits through the shared slide-over. All writes route through
// lib/tasks/mutations so every surface stays consistent.
export default function TasksPage() {
  const { session, flash } = useApp();
  const userId = session?.user?.id;

  const [tasks, setTasks] = useState([]);
  const [subCounts, setSubCounts] = useState({});
  const [focusSubs, setFocusSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [shelfQuick, setShelfQuick] = useState("");
  const [view, setView] = useState("active"); // active | completed | archived

  const load = useCallback(async () => {
    if (!userId) return;
    const lists = await Promise.all(getTaskProviders().map((p) => p.listTasks({ userId })));
    const all = lists.flat();
    setTasks(all);
    setLoading(false);
    const plannerIds = all.filter((t) => t.kind === "planner").map((t) => t.id);
    if (plannerIds.length) {
      const { byPlanner } = await fetchSubtaskCounts({ plannerIds });
      setSubCounts(byPlanner);
    } else {
      setSubCounts({});
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const focusTask = useMemo(() => tasks.find((t) => t.inProgress && !t.done && !t.archived) || null, [tasks]);

  // Load the focused task's subtasks so the banner ring reflects progress.
  useEffect(() => {
    let live = true;
    if (!focusTask) { setFocusSubs([]); return; }
    fetchSubtasks({ plannerTaskId: focusTask.id }).then(({ data }) => { if (live) setFocusSubs(data || []); });
    return () => { live = false; };
  }, [focusTask?.id]);

  // View filter: Active (not archived, not done) / Completed (done) / Archived.
  const inView = useMemo(() => {
    if (view === "archived") return tasks.filter((t) => t.archived);
    const live = tasks.filter((t) => !t.archived);
    return view === "completed" ? live.filter((t) => t.done) : live.filter((t) => !t.done);
  }, [tasks, view]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return inView;
    return inView.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.labels.some((l) => (TASK_LABELS[l]?.name || l).toLowerCase().includes(q)),
    );
  }, [inView, q]);

  const liveTasks = tasks.filter((t) => !t.archived);
  const openCount = liveTasks.filter((t) => !t.done).length;
  const doneCount = liveTasks.filter((t) => t.done).length;
  const archivedCount = tasks.filter((t) => t.archived).length;
  const selected = tasks.find((t) => t.id === selectedId) || null;

  // ── mutations (optimistic; route through the shared write path) ───────────
  const patchTask = (id, patch) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const onSetStatus = async (t, status) => {
    const r = await taskMutations.setTaskStatus({ userId, task: t, status });
    if (r?.error) { flash?.("✗ Could not update status"); return; }
    patchTask(t.id, r.patch || { status, done: status === "done" });
  };

  const onSetFocus = async (t) => {
    if (t.inProgress) { await onClearFocus(t); return; }
    const r = await taskMutations.setFocus({ userId, taskId: t.id });
    if (r?.error) { flash?.("✗ Could not set focus"); return; }
    setTasks((prev) => prev.map((x) => ({ ...x, inProgress: x.id === t.id })));
  };
  const onClearFocus = async (t) => {
    const r = await taskMutations.clearFocus({ userId, taskId: t.id });
    if (r?.error) { flash?.("✗ Could not clear focus"); return; }
    patchTask(t.id, { inProgress: false });
  };

  const onDeleted = (id) => { setTasks((prev) => prev.filter((t) => t.id !== id)); setSelectedId(null); };
  const onChange = (updated) => patchTask(updated.id, updated);

  const createAndOpen = async (dueDate, title = "New task") => {
    const { data, error } = await taskMutations.createTask({ userId, title, dueDate });
    if (error || !data) { flash?.("✗ Could not create task"); return; }
    await load();
    setSelectedId(data.id);
  };

  const addShelf = async () => {
    const title = shelfQuick.trim();
    if (!title) return;
    const { data, error } = await taskMutations.createTask({ userId, title, dueDate: null });
    if (error || !data) { flash?.("✗ Could not add task"); return; }
    setShelfQuick("");
    await load();
  };

  return (
    <div className="tl-ocean">
      {/* topbar */}
      <header className="tl-topbar">
        <div style={{ minWidth: 0 }}>
          <div className="tl-title">Everything due, in a line</div>
          <div className="tl-sub">Sorted by when it's due · {openCount} open, {doneCount} done</div>
        </div>
        <div className="tl-seg" data-tour="tasks-views" role="tablist" aria-label="Task view">
          {[
            { key: "active", label: "Active" },
            { key: "completed", label: `Completed${doneCount ? ` ${doneCount}` : ""}` },
            { key: "archived", label: `Archived${archivedCount ? ` ${archivedCount}` : ""}` },
          ].map((v) => (
            <button key={v.key} role="tab" aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        <div className="tl-search">
          <Search style={{ width: 16, height: 16, color: "var(--o-ink-400)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" />
        </div>
        <button className="tl-newbtn" data-tour="tasks-new" onClick={() => createAndOpen(null)}><Plus style={{ width: 16, height: 16 }} /> New task</button>
      </header>

      {/* focus banner */}
      <div className="tl-focuswrap" data-tour="tasks-focus-banner">
        <FocusBanner focusTask={focusTask} subs={focusSubs} onOpen={(t) => setSelectedId(t.id)} onClearFocus={onClearFocus} />
      </div>

      {/* timeline */}
      <div className="tl-body" data-tour="tasks-timeline">
        {loading ? (
          <div className="tl-inner"><div className="tl-empty">Loading your tasks…</div></div>
        ) : view !== "active" && visible.length === 0 ? (
          <div className="tl-inner"><div className="tl-empty">{view === "archived" ? "No archived tasks." : "No completed tasks yet."}</div></div>
        ) : (
          <TaskTimeline
            tasks={visible}
            subCounts={subCounts}
            focusId={focusTask?.id}
            onOpen={(t) => setSelectedId(t.id)}
            onSetStatus={onSetStatus}
            onSetFocus={onSetFocus}
            showCapture={view === "active"}
            shelfQuick={shelfQuick}
            onShelfChange={setShelfQuick}
            onShelfAdd={addShelf}
          />
        )}
      </div>

      {selected && (
        <TaskDetailSheet
          task={selected}
          onClose={() => setSelectedId(null)}
          onChange={onChange}
          onDeleted={onDeleted}
          onSetFocus={onSetFocus}
        />
      )}
    </div>
  );
}
