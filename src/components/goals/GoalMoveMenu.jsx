import { useEffect, useRef, useState } from "react";
import { FolderInput, Building2 } from "lucide-react";
import { reassignGoal } from "../../lib/goals";

// Reassign a goal to a different owner — move it between the company and
// departments, or elevate a personal goal into a team goal. `targets` is a
// list of { ownerType, ownerId, ownerName, ownerColor, label }.
export default function GoalMoveMenu({ goal, targets = [], onMoved, dark, title = "Move goal", icon: Icon = FolderInput }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!targets.length) return null;

  const move = async (t) => {
    setOpen(false);
    await reassignGoal({ id: goal.id, ownerType: t.ownerType, ownerId: t.ownerId, ownerName: t.ownerName, ownerColor: t.ownerColor });
    onMoved?.();
  };

  return (
    <span ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        className={`mt-0.5 transition-colors ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className={`absolute right-0 mt-1 z-50 w-52 max-h-60 overflow-y-auto rounded-lg border shadow-lg p-1 ${
          dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}>
          <p className={`px-2 py-1 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>{title}</p>
          {targets.map((t) => (
            <button
              key={`${t.ownerType}:${t.ownerId}`}
              type="button"
              onClick={() => move(t)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs ${dark ? "hover:bg-white/5 text-slate-200" : "hover:bg-slate-50 text-slate-700"}`}
            >
              {t.ownerType === "company" ? (
                <Building2 className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]" />
              ) : (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.ownerColor || "#64748b" }} />
              )}
              <span className="truncate">{t.label || t.ownerName}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
