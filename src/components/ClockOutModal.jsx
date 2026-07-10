import { useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import TimeSelect from "./TimeSelect";
import ProjectPicker from "./ProjectPicker";
import { calcWorked, formatDuration, toDisplayTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import EmojiTextField from "./EmojiTextField";
import { Checkbox } from "@/components/ui/checkbox";

// Shown right after you clock out (pendingEntry is set) so you can save + edit
// the day's time WITHOUT navigating to the timesheet. Same fields as the
// timesheet's post-clock-out form (description / projects / billable), plus
// editable start/end. On the timesheet page the inline form already handles it,
// so we skip the modal there to avoid a double.
export default function ClockOutModal() {
  const {
    pendingEntry, updatePendingEntry, clearPendingEntry, handleSubmit,
    deepseekKey, rewriteDescription, rewritingDesc,
  } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { pathname } = useLocation();

  if (!pendingEntry || pathname.startsWith("/log") || pathname.startsWith("/time-tracker/log")) return null;

  // Editing start/end recomputes the worked minutes (breaks held constant).
  const setTime = (field, v) => {
    const next = { ...pendingEntry, [field]: v };
    updatePendingEntry({ [field]: v, minutes: calcWorked(next.start, next.end, next.breaks || []) });
  };
  const save = () => { handleSubmit(pendingEntry); clearPendingEntry(); };

  const inputCls = dark
    ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400";

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl p-5"
        style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Check className="w-4 h-4 text-[var(--color-accent)]" />
          <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Clocked out — log your time</span>
        </div>

        {/* Duration + editable start / end */}
        <div className={`rounded-xl border p-4 mb-3 ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"}`}>
          <div className="text-3xl font-bold font-mono mb-3" style={{ color: dark ? "#fff" : "#1e293b" }}>
            {formatDuration(pendingEntry.minutes)}
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Start</div>
              <TimeSelect value={pendingEntry.start} onChange={(v) => setTime("start", v)} />
            </div>
            <span className="opacity-50 pb-2">–</span>
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">End</div>
              <TimeSelect value={pendingEntry.end} onChange={(v) => setTime("end", v)} />
            </div>
          </div>
          {(pendingEntry.breaks || []).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {pendingEntry.breaks.map((b) => (
                <span key={b.id} className={`text-xs px-2 py-0.5 rounded-full border ${dark ? "bg-slate-700/50 border-slate-600 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"}`}>
                  break {toDisplayTime(b.start)}–{toDisplayTime(b.end)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* What did you work on */}
        <EmojiTextField component={Textarea}
          value={pendingEntry.description || ""}
          onChange={(e) => updatePendingEntry({ description: e.target.value })}
          placeholder="What did you work on?"
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm min-h-[80px] mb-2 ${inputCls}`}
        />
        {deepseekKey && (
          <button
            type="button"
            onClick={() => rewriteDescription(pendingEntry.description, (v) => updatePendingEntry({ description: v }))}
            disabled={rewritingDesc || !pendingEntry.description?.trim()}
            className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border text-[var(--color-accent)] border-slate-200 dark:border-[var(--color-border)] disabled:opacity-40"
          >
            {rewritingDesc ? "Rewriting…" : "✦ Rewrite"}
          </button>
        )}
        <div className="mb-3">
          <ProjectPicker selectedIds={pendingEntry.projectIds || []} onChange={(ids) => updatePendingEntry({ projectIds: ids })} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <Checkbox
            checked={pendingEntry.billable !== false}
            onCheckedChange={(v) => updatePendingEntry({ billable: !!v })}
            className="w-5 h-5 rounded border-2 data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]"
          />
          <span className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-600"}`}>Billable</span>
        </label>

        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            disabled={!pendingEntry.date || !pendingEntry.start || !pendingEntry.end}
            className="flex-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white disabled:opacity-50"
          >
            Save to timesheet
          </Button>
          <button
            type="button"
            onClick={clearPendingEntry}
            title="Don't log this session"
            className={`px-4 py-2 rounded-lg text-sm font-medium ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
