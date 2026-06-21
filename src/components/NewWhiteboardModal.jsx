import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, PenLine, Check, Users, User as UserIcon } from "lucide-react";
import {
  createWhiteboard,
  listWhiteboardTemplates,
  fetchTemplateSnapshot,
} from "../lib/whiteboard";

// Modal for creating a new whiteboard. Start blank, or seed from one of your
// saved templates (personal or team). ESC / click-outside close.

export default function NewWhiteboardModal({ open, onClose, teamId, onCreated }) {
  const { theme } = useTheme();
  const { session } = useApp();
  const dark = theme === "dark";

  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("blank"); // "blank" | template id
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(""); setChoice("blank"); setBusy(false); setError("");
    let alive = true;
    listWhiteboardTemplates(teamId).then(({ data }) => { if (alive) setTemplates(data || []); });
    return () => { alive = false; };
  }, [open, teamId]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!teamId) { setError("Pick a team first."); return; }
    setBusy(true); setError("");
    let snapshot = null;
    if (choice !== "blank") {
      const { data: snap, error: snapErr } = await fetchTemplateSnapshot(choice);
      if (snapErr) { setBusy(false); setError(snapErr.message || "Could not load that template."); return; }
      snapshot = snap;
    }
    const { data, error: err } = await createWhiteboard({
      teamId,
      title: title.trim() || "Whiteboard",
      createdBy: session?.user?.id,
      snapshot,
    });
    setBusy(false);
    if (err || !data) { setError(err?.message || "Could not create whiteboard."); return; }
    onCreated?.(data);
    onClose?.();
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${
    dark ? "text-slate-400" : "text-slate-500"
  }`;

  function Card({ active, onClick, Icon, name, sub }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
          active
            ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
            : dark
              ? "border-[var(--color-border)] hover:border-[var(--color-accent)]/60"
              : "border-slate-200 hover:border-[var(--color-accent)]/60"
        }`}
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          active ? "bg-[var(--color-accent)] text-white" : dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-100 text-slate-600"
        }`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{name}</p>
          <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>{sub}</p>
        </div>
        {active && <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
      role="dialog"
      aria-modal="true"
    >
      <form className={cardCls} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className={`text-lg font-bold mb-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          New whiteboard
        </h2>
        <p className={`text-xs mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Start blank or from one of your saved templates. You can rename it later.
        </p>

        <div className="mb-4">
          <label className={labelCls}>Start from</label>
          <div className="mt-2 grid grid-cols-1 gap-2 max-h-[260px] overflow-y-auto pr-0.5">
            <Card active={choice === "blank"} onClick={() => setChoice("blank")} Icon={PenLine} name="Blank board" sub="A clean infinite canvas" />
            {templates.map((t) => (
              <Card
                key={t.id}
                active={choice === t.id}
                onClick={() => setChoice(t.id)}
                Icon={t.scope === "org" ? Users : UserIcon}
                name={t.name}
                sub={t.scope === "org" ? "Team template" : "Personal template"}
              />
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="wb-title" className={labelCls}>Name</label>
          <Input
            id="wb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="Whiteboard"
            className="mt-1.5"
          />
        </div>

        {error && (
          <div className={`text-xs font-medium px-3 py-1.5 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !teamId}>
            {busy ? "Creating…" : "Create whiteboard"}
          </Button>
        </div>
      </form>
    </div>
  );
}
