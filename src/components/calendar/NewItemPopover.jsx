import { useState } from "react";
import { CheckSquare, Flag, Video, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Modal from "../Modal";

// Shown when the user selects an empty calendar slot: quick-add a task, or jump
// to the milestone / meeting modals. The parent owns the selected slot + actions.

export default function NewItemPopover({ dark, slotLabel, onClose, onCreateTask, onPickMilestone, onPickMeeting }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const field = dark
    ? "bg-[var(--color-surface-2,#1e293b)] border-[var(--color-border)] text-slate-100"
    : "bg-white border-slate-300 text-slate-900";

  async function addTask(e) {
    e?.preventDefault?.();
    if (!title.trim() || busy) return;
    setBusy(true);
    await onCreateTask(title.trim());
    setBusy(false);
    onClose?.();
  }

  const row = `w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
    dark ? "border-[var(--color-border)] hover:bg-white/5 text-slate-200" : "border-slate-200 hover:bg-slate-50 text-slate-700"
  }`;

  return (
    <Modal open onClose={onClose} labelledBy="newitem-title">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xs rounded-2xl border shadow-xl p-4 ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="newitem-title" className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
            Add to {slotLabel}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={addTask} className="flex items-center gap-2 mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title…"
            autoFocus
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${field}`}
          />
          <Button type="submit" size="sm" disabled={!title.trim() || busy}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        <div className={`text-[11px] uppercase tracking-wide mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>or add</div>
        <div className="space-y-1.5">
          <button type="button" className={row} onClick={() => { onPickMilestone(); onClose?.(); }}>
            <Flag className="w-4 h-4" /> Milestone / deadline
          </button>
          <button type="button" className={row} onClick={() => { onPickMeeting(); onClose?.(); }}>
            <Video className="w-4 h-4" /> Meeting
          </button>
        </div>
      </div>
    </Modal>
  );
}
