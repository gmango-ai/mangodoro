import { useEffect, useState } from "react";
import { X, GitBranch } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// Admin picker for a member's manager (org reporting line). A plain select of
// org members (minus self) + "No manager". Drives team_members.manager_id via
// the parent's onSave → setMemberManager.
export default function MemberManagerModal({ open, onClose, member, members = [], currentManagerId, nameOf, onSave }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [managerId, setManagerId] = useState(currentManagerId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setManagerId(currentManagerId || ""); setError(null); }, [currentManagerId, member]);

  if (!open || !member) return null;

  const label = (m) => (nameOf ? nameOf(m) : m.name || "Member");
  const options = members.filter((m) => m.user_id !== member.user_id);

  const save = async () => {
    setSaving(true); setError(null);
    const { error: err } = await onSave(managerId || null);
    setSaving(false);
    if (err) setError(err.message || "Could not save"); else onClose();
  };

  const fieldCls = dark
    ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100"
    : "bg-white border-slate-300 text-slate-800";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Set manager">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative w-full max-w-sm rounded-2xl border shadow-2xl ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
      }`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold">Manager for {label(member)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded ${dark ? "hover:bg-white/10" : "hover:bg-black/10"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wider opacity-60">Reports to</label>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className={`w-full rounded-md border px-2 py-2 text-[13px] outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${fieldCls}`}
          >
            <option value="">No manager (top level)</option>
            {options.map((m) => (
              <option key={m.user_id} value={m.user_id}>{label(m)}</option>
            ))}
          </select>
          {error && <p className="text-[11px] text-rose-500">{error}</p>}
        </div>

        <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <button type="button" onClick={onClose} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${dark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-slate-100"}`}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
