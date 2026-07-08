import { useState } from "react";
import { ClipboardList, X, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Modal from "../Modal";
import {
  updatePlannerTaskFields, deletePlannerTask,
  updatePersonalTaskFields, deletePersonalTask,
} from "../../lib/calendar";

// Edit a task from the calendar. kind = 'planner' | 'personal'.
export default function TaskEditModal({ task, kind = "planner", dark, onClose, onSaved }) {
  const isPlanner = kind === "planner";
  const [title, setTitle] = useState(task?.title || "");
  const [done, setDone] = useState(!!task?.done);
  const [plannerDate, setPlannerDate] = useState(task?.planner_date || "");
  const [dueDate, setDueDate] = useState(task?.due_date || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const field = dark
    ? "bg-[var(--color-surface-2,#1e293b)] border-[var(--color-border)] text-slate-100"
    : "bg-white border-slate-300 text-slate-900";
  const labelCls = `block text-xs font-semibold mb-1 ${dark ? "text-slate-300" : "text-slate-600"}`;

  async function save(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!title.trim()) { setError("Give the task a title"); return; }
    setBusy(true); setError("");
    const patch = { title: title.trim(), done, due_date: dueDate || null };
    if (isPlanner && plannerDate) patch.planner_date = plannerDate; // never null a NOT NULL col
    const { error: err } = isPlanner
      ? await updatePlannerTaskFields(task.id, patch)
      : await updatePersonalTaskFields(task.id, patch);
    setBusy(false);
    if (err) { setError(err.message || "Could not save"); return; }
    onSaved?.(); onClose?.();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const { error: err } = isPlanner ? await deletePlannerTask(task.id) : await deletePersonalTask(task.id);
    setBusy(false);
    if (err) { setError(err.message || "Could not delete"); return; }
    onSaved?.(); onClose?.();
  }

  return (
    <Modal open onClose={onClose} labelledBy="task-edit-title">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-sm rounded-2xl border shadow-xl p-5 ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="task-edit-title" className={`flex items-center gap-2 text-base font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
            <ClipboardList className="w-4 h-4" /> Edit task
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={save} className="space-y-3">
          <div>
            <label className={labelCls}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {isPlanner && task?.planner_date && (
              <div>
                <label className={labelCls}>Scheduled for</label>
                <input type="date" value={plannerDate} onChange={(e) => setPlannerDate(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
              </div>
            )}
            <div>
              <label className={labelCls}>Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
            </div>
          </div>
          <label className={`flex items-center gap-2 text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="accent-[var(--color-accent)]" />
            Mark done
          </label>

          {error && <p className={`text-xs font-medium ${dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={remove} disabled={busy} className={dark ? "text-red-400" : "text-red-600"}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
