import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X, ScrollText, Lightbulb, PenLine, Check,
} from "lucide-react";
import { TEMPLATE_LIST, createWhiteboard } from "../lib/whiteboard";

// Modal for creating a new whiteboard. Pick a template + title, hand
// off to onCreated with the new row. Bridge to NewRetroModal's UX
// patterns (title, ESC to close, click outside) so this feels native.

const TEMPLATE_ICON = {
  weekly_review: ScrollText,
  brainstorm: Lightbulb,
  blank: PenLine,
};

export default function NewWhiteboardModal({
  open, onClose, teamId, onCreated,
}) {
  const { theme } = useTheme();
  const { session } = useApp();
  const dark = theme === "dark";

  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState("weekly_review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTemplateKey("weekly_review");
    setBusy(false);
    setError("");
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!teamId) { setError("Pick a team first."); return; }
    setBusy(true); setError("");
    const { data, error: err } = await createWhiteboard({
      teamId,
      title: title.trim() || defaultTitle(templateKey),
      templateKey,
      createdBy: session?.user?.id,
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
          Pick a template and give it a name. You can rename it later.
        </p>

        <div className="mb-4">
          <label className={labelCls}>Template</label>
          <div className="mt-2 grid grid-cols-1 gap-2">
            {TEMPLATE_LIST.map((tpl) => {
              const Icon = TEMPLATE_ICON[tpl.key] || PenLine;
              const selected = templateKey === tpl.key;
              return (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => setTemplateKey(tpl.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                      : dark
                        ? "border-[var(--color-border)] hover:border-[var(--color-accent)]/60"
                        : "border-slate-200 hover:border-[var(--color-accent)]/60"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    selected ? "bg-[var(--color-accent)] text-white" : dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-100 text-slate-600"
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{tpl.name}</p>
                    <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>{tpl.desc}</p>
                  </div>
                  {selected && <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="wb-title" className={labelCls}>Name</label>
          <Input
            id="wb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder={defaultTitle(templateKey)}
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

function defaultTitle(templateKey) {
  switch (templateKey) {
    case "weekly_review": return weeklyReviewDefault();
    case "brainstorm":    return "Brainstorm";
    default:              return "Whiteboard";
  }
}

function weeklyReviewDefault() {
  const today = new Date();
  const month = today.toLocaleDateString("en-US", { month: "short" });
  return `Weekly Review · ${month} ${today.getDate()}`;
}
