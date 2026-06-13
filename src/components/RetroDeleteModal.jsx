import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, AlertTriangle, Trash2 } from "lucide-react";
import { formatRetroWeek } from "../lib/retro";

// Hard-delete confirmation. The retro week label has to be typed
// verbatim — this is irrecoverable and cascades to retro_cards +
// retro_guests. Mirror RemoveMemberModal in shape.
export default function RetroDeleteModal({ open, onClose, retro, busy, onConfirm }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) setDraft("");
  }, [open]);

  if (!open || !retro) return null;

  const label = formatRetroWeek(retro.week_start);
  const matches = draft.trim().toLowerCase() === label.toLowerCase();
  const retroName = retro.org_team_name || retro.department || "Team";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
          dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
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
          dark ? "bg-slate-800/40 border-slate-700" : "bg-slate-50 border-slate-200"
        }`}>
          <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {retroName} — {label}
          </p>
          <p className={`text-[11px] mt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            If you don't need this gone forever, Archive instead — it's reversible.
          </p>
        </div>

        <div className="mb-4">
          <label className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-400" : "text-slate-500"
          }`}>
            Type "{label}" to confirm
          </label>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={label}
            className={`mt-1 ${dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}`}
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || !matches}
            className={dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            {busy ? "Deleting…" : "Delete retro"}
          </Button>
        </div>
      </div>
    </div>
  );
}
