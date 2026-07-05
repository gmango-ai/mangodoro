import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Trash2 } from "lucide-react";
import { formatRetroWeek } from "../lib/retro";
import Modal from "./Modal";

// Hard-delete confirmation. The action is destructive and cascades to
// retro_cards + retro_guests, but we trust admins to read the message
// rather than gate behind a type-to-confirm step — Archive remains the
// safe path for "I might want this back".
export default function RetroDeleteModal({ open, onClose, retro, busy, onConfirm }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  if (!open || !retro) return null;

  const label = formatRetroWeek(retro.week_start);
  const retroName = retro.org_team_name || retro.department || "Team";

  return (
    // No backdrop/Escape dismissal mid-delete — matches the disabled Cancel.
    <Modal onClose={busy ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
        }`}
      >
        <button
          type="button"
          onClick={busy ? undefined : onClose}
          disabled={busy}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg shrink-0 ${
            dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Delete retro?
            </h2>
            <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
              This is permanent and cascades to cards + guests.
            </p>
          </div>
        </div>

        <div className={`rounded-lg border p-3 mb-4 ${
          dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"
        }`}>
          <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {retroName} — {label}
          </p>
          <p className={`text-[11px] mt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            If you don't need this gone forever, Archive instead — it's reversible.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            {busy ? "Deleting…" : "Delete retro"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
