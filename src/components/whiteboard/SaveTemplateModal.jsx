import { useEffect, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, User as UserIcon, Users, Check } from "lucide-react";
import { saveWhiteboardTemplate } from "../../lib/whiteboard";

// Save the current board as a reusable template — personal (only you) or team
// (everyone on the team). `getSnapshot` returns the live { nodes, edges }.
export default function SaveTemplateModal({ open, onClose, getSnapshot, teamId, ownerId, defaultName }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [name, setName] = useState("");
  const [scope, setScope] = useState("personal"); // "personal" | "org"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || "");
    setScope("personal");
    setBusy(false);
    setError("");
    setDone(false);
  }, [open, defaultName]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error: err } = await saveWhiteboardTemplate({
      name: name.trim() || "Untitled template",
      scope,
      ownerId,
      teamId,
      snapshot: getSnapshot(),
    });
    setBusy(false);
    if (err) { setError(err.message || "Could not save template."); return; }
    setDone(true);
    setTimeout(() => onClose?.(), 750);
  }

  const cardCls = `relative w-full max-w-sm rounded-2xl border p-5 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  function ScopeBtn({ value, Icon, title, sub }) {
    const active = scope === value;
    const disabled = value === "org" && !teamId;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setScope(value)}
        className={`flex-1 flex items-start gap-2 p-3 rounded-xl border text-left transition-colors disabled:opacity-40 ${
          active
            ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
            : dark ? "border-[var(--color-border)] hover:border-[var(--color-accent)]/60" : "border-slate-200 hover:border-[var(--color-accent)]/60"
        }`}
      >
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-[var(--color-accent)]" : dark ? "text-slate-400" : "text-slate-500"}`} />
        <span className="min-w-0">
          <span className={`block text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{title}</span>
          <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>{sub}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
      role="dialog"
      aria-modal="true"
    >
      <form className={cardCls} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"}`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className={`text-lg font-bold mb-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>Save as template</h2>
        <p className={`text-xs mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Reuse this board's layout for future whiteboards.
        </p>

        <div className="mb-4">
          <label htmlFor="tpl-name" className={labelCls}>Name</label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="Template name" className="mt-1.5" autoFocus />
        </div>

        <div className="mb-4">
          <label className={labelCls}>Who can use it</label>
          <div className="mt-2 flex gap-2">
            <ScopeBtn value="personal" Icon={UserIcon} title="Personal" sub="Only you" />
            <ScopeBtn value="org" Icon={Users} title="Team" sub={teamId ? "Everyone on the team" : "Pick a team first"} />
          </div>
        </div>

        {error && (
          <div className={`text-xs font-medium px-3 py-1.5 rounded-lg mb-3 ${dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"}`}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || done}>
            {done ? (<span className="inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>) : busy ? "Saving…" : "Save template"}
          </Button>
        </div>
      </form>
    </div>
  );
}
