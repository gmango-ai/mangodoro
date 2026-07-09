import { useState } from "react";
import EmojiTextField from "../EmojiTextField";
import { Flag, X, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Modal from "../Modal";
import { createMilestone, updateMilestone, deleteMilestone } from "../../lib/milestones";

// Create / edit a milestone (a deadline / big date). Personal or team-shared.

export default function MilestoneModal({ teamId, dark, initialDate, milestone, onClose, onSaved }) {
  const editing = !!milestone;
  const [title, setTitle] = useState(milestone?.title || "");
  const [description, setDescription] = useState(milestone?.description || "");
  const [date, setDate] = useState(milestone?.milestone_date || initialDate || "");
  const [time, setTime] = useState(milestone?.milestone_time ? String(milestone.milestone_time).slice(0, 5) : "");
  const [scope, setScope] = useState(milestone?.scope || "personal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const field = dark
    ? "bg-[var(--color-surface-2,#1e293b)] border-[var(--color-border)] text-slate-100"
    : "bg-white border-slate-300 text-slate-900";
  const labelCls = `block text-xs font-semibold mb-1 ${dark ? "text-slate-300" : "text-slate-600"}`;

  async function submit(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!title.trim()) { setError("Give the milestone a title"); return; }
    if (!date) { setError("Pick a date"); return; }
    setBusy(true); setError("");
    const payload = { title: title.trim(), description, date, time: time || null, scope };
    const { error: err } = editing
      ? await updateMilestone(milestone.id, {
          title: payload.title, description: description || null,
          milestone_date: date, milestone_time: time || null, scope,
        })
      : await createMilestone({ teamId, ...payload });
    setBusy(false);
    if (err) { setError(err.message || "Could not save milestone"); return; }
    onSaved?.();
    onClose?.();
  }

  async function remove() {
    if (!editing || busy) return;
    setBusy(true);
    const { error: err } = await deleteMilestone(milestone.id);
    setBusy(false);
    if (err) { setError(err.message || "Could not delete"); return; }
    onSaved?.();
    onClose?.();
  }

  return (
    <Modal open onClose={onClose} labelledBy="milestone-title">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border shadow-xl p-5 ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="milestone-title" className={`flex items-center gap-2 text-base font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
            <Flag className="w-4 h-4" /> {editing ? "Edit milestone" : "New milestone"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className={labelCls}>Title</label>
            <EmojiTextField value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
            </div>
            <div>
              <label className={labelCls}>Time (optional)</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes (optional)</label>
            <EmojiTextField multiline value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
          </div>
          <div>
            <label className={labelCls}>Visibility</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`}>
              <option value="personal">Just me</option>
              <option value="team">Shared with the team</option>
            </select>
          </div>

          {error && <p className={`text-xs font-medium ${dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {editing ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={busy} className={dark ? "text-red-400" : "text-red-600"}>
                <Trash2 className="w-4 h-4 mr-1.5" /> Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Flag className="w-4 h-4 mr-1.5" />}
                {editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
