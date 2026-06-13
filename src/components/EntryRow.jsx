import { useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import TimeSelect from "./TimeSelect";
import { calcWorked, formatDuration, formatDecimal, toDisplayTime, unpaidBreakMins, formatMoney } from "../lib/utils";
import { Edit2, Save, X, Trash2, Copy } from "lucide-react";
import ProjectPicker from "./ProjectPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

function timeToHour(t) {
  if (!t) return 8;
  const [h, m] = t.split(":").map(Number);
  return h + m / 60;
}

export default function EntryRow({ entry, index }) {
  const {
    inlineEditId, inlineForm,
    startInlineEdit, cancelInlineEdit, saveInlineEdit, setInlineField,
    addInlineBreak, updateInlineBreak, removeInlineBreak,
    handleDelete, duplicateEntry,
    hourlyRate, projects,
    deepseekKey, rewriteDescription, rewritingDesc,
  } = useApp();

  const descRef = useRef(null);
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [inlineForm?.description]);

  const { theme } = useTheme();
  const dark = theme === "dark";
  const isEditing = inlineEditId === entry.id;

  const inputClass = `w-full px-4 py-3 rounded-lg text-sm transition-all focus:outline-none focus:ring-2 ${
    dark
      ? "bg-slate-900/50 border border-slate-700/50 text-white placeholder:text-slate-500 focus:border-[var(--color-accent)] focus:ring-[var(--color-accent-light)]"
      : "bg-white/80 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-accent)] focus:ring-[var(--color-accent-light)]"
  }`;

  if (isEditing && inlineForm) {
    const inlinePreviewMins = calcWorked(inlineForm.start, inlineForm.end, inlineForm.breaks);
    return (
      <div className={`p-4 sm:p-5 rounded-xl border transition-all ${
        dark ? "bg-slate-800/40 border-[var(--color-accent)] shadow-lg" : "bg-white/80 border-[var(--color-accent)] shadow-lg"
      }`}>
        <div className="grid grid-cols-1 gap-4 mb-4">
          <div>
            <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>Date</label>
            <input
              type="date"
              value={inlineForm.date}
              onChange={(e) => setInlineField("date", e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>Start</label>
              <TimeSelect value={inlineForm.start} onChange={(v) => setInlineField("start", v)} />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>End</label>
              <TimeSelect value={inlineForm.end} onChange={(v) => setInlineField("end", v)} />
            </div>
          </div>
        </div>

        <div className="mb-4">
          <Textarea
            ref={descRef}
            value={inlineForm.description}
            onChange={(e) => {
              setInlineField("description", e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            placeholder="Description…"
            className={`${inputClass} resize-none overflow-hidden min-h-[80px]`}
          />
          {deepseekKey && (
            <button
              onClick={() => rewriteDescription(inlineForm.description, (v) => setInlineField("description", v))}
              disabled={rewritingDesc || !inlineForm.description?.trim()}
              className={`mt-1.5 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                dark
                  ? "bg-slate-800/80 border-slate-700 text-[var(--color-accent)] hover:enabled:bg-slate-700 hover:enabled:border-[var(--color-accent)]"
                  : "bg-white/80 border-slate-200 text-[var(--color-accent)] hover:enabled:bg-slate-50 hover:enabled:border-[var(--color-accent)]"
              }`}
            >
              {rewritingDesc ? (
                <><span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" /> Rewriting</>
              ) : "✦ Rewrite"}
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
          <div className="flex-1 w-full">
            <ProjectPicker
              selectedIds={inlineForm.projectIds || []}
              onChange={(ids) => setInlineField("projectIds", ids)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`ib-bill-${entry.id}`}
              checked={inlineForm.billable !== false}
              onCheckedChange={(v) => setInlineField("billable", !!v)}
              className={`w-5 h-5 rounded border-2 transition-all ${
                dark
                  ? "border-slate-700 data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]"
                  : "border-slate-300 data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]"
              }`}
            />
            <Label htmlFor={`ib-bill-${entry.id}`} className={`text-sm font-medium cursor-pointer ${dark ? "text-slate-300" : "text-slate-600"}`}>
              Billable
            </Label>
          </div>
        </div>

        <div className="mb-4">
          {inlineForm.breaks.map((b) => (
            <div key={b.id} className={`p-3 mb-2 rounded-lg border transition-all ${
              dark ? "bg-slate-900/40 border-slate-700/50" : "bg-slate-50/50 border-slate-200/50"
            }`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                <div>
                  <span className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>From</span>
                  <TimeSelect value={b.start} onChange={(v) => updateInlineBreak(b.id, { start: v })} />
                </div>
                <div>
                  <span className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>To</span>
                  <TimeSelect value={b.end} onChange={(v) => updateInlineBreak(b.id, { end: v })} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id={`ib-${b.id}`}
                    checked={b.unpaid}
                    onCheckedChange={(v) => updateInlineBreak(b.id, { unpaid: !!v })}
                    className={`w-4 h-4 rounded-sm border transition-all ${
                      dark
                        ? "border-slate-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        : "border-slate-300 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                    }`}
                  />
                  <span className={`text-xs font-medium ${dark ? "text-slate-400" : "text-slate-600"}`}>Unpaid</span>
                </label>
                <button
                  onClick={() => removeInlineBreak(b.id)}
                  className={`text-xs font-medium px-2 py-1 rounded transition-colors ${dark ? "text-red-400 hover:bg-red-500/10" : "text-red-500 hover:bg-red-50"}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addInlineBreak} className={`h-8 text-xs font-medium border-dashed ${
            dark ? "border-slate-700 text-slate-300 hover:text-white" : "border-slate-300 text-slate-600 hover:text-slate-900"
          }`}>+ Add break</Button>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200 dark:border-slate-700/50">
          <div className="font-mono flex items-baseline gap-2 w-full sm:w-auto text-center sm:text-left">
            {inlineForm.start && inlineForm.end && (
              <>
                <span className={`text-xl font-semibold bg-gradient-to-r bg-clip-text text-transparent ${
                  dark ? "from-cyan-400 to-teal-400" : "from-teal-600 to-emerald-600"
                }`}>{formatDuration(inlinePreviewMins)}</span>
                <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{formatDecimal(inlinePreviewMins)}h</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <Button
              variant="ghost"
              onClick={cancelInlineEdit}
              className={`h-9 px-4 text-sm font-medium ${dark ? "text-slate-300 hover:text-white hover:bg-slate-800" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}
            >
              Cancel
            </Button>
            <Button
              onClick={saveInlineEdit}
              disabled={!inlineForm.date || !inlineForm.start || !inlineForm.end}
              className={`h-9 px-6 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                dark
                  ? "bg-gradient-to-r from-cyan-500 to-teal-500 shadow-cyan-500/30 hover:shadow-cyan-500/50"
                  : "bg-gradient-to-r from-teal-600 to-emerald-600 shadow-teal-500/30 hover:shadow-teal-500/50"
              } border-none`}
            >
              Save <Save className="ml-1 w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const bm = unpaidBreakMins(entry);
  const entryProjects = (entry.project_ids || []).map((id) => projects.find((p) => p.id === id)).filter(Boolean);

  const startH = timeToHour(entry.start);
  const endH = timeToHour(entry.end);
  const leftPct = Math.max(0, Math.min(100, ((startH - 8) / 12) * 100));
  const widthPct = Math.max(0, Math.min(100 - leftPct, ((endH - startH) / 12) * 100));

  return (
    <div className={`p-4 rounded-xl border transition-all relative overflow-hidden group ${
      dark
        ? "bg-slate-800/30 border-slate-700/50 hover:border-slate-600/50 hover:bg-slate-800/50"
        : "bg-white/50 border-slate-200/50 hover:border-slate-300/60 hover:bg-white/80 hover:shadow-sm"
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-3 gap-3 relative z-10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {entryProjects.length > 0 ? entryProjects.map((project) => (
              <span
                key={project.id}
                style={{ backgroundColor: project.color + "22", color: project.color, borderColor: project.color + "44" }}
                className="text-xs px-2.5 py-0.5 rounded-full font-medium border"
              >
                {project.name}
              </span>
            )) : (
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                dark ? "bg-slate-700/50 text-slate-400" : "bg-slate-100 text-slate-500"
              }`}>
                No project
              </span>
            )}
            {entry.billable !== false && (
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                dark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
              }`}>
                Billable
              </span>
            )}
          </div>
          
          <p className={`font-medium mb-2 pr-4 ${dark ? "text-white" : "text-slate-800"} ${!entry.description ? "opacity-40 italic" : ""}`}>
            {entry.description || "No description"}
          </p>
          
          <div className="flex items-center gap-4 flex-wrap">
            <span className={`text-sm font-mono flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {toDisplayTime(entry.start)} <span className="text-[10px] opacity-60">→</span> {toDisplayTime(entry.end)}
            </span>
            {bm > 0 && (
              <span className={`text-xs flex items-center gap-1 ${dark ? "text-orange-400/80" : "text-orange-600/80"}`}>
                <span className={`w-1 h-1 rounded-full ${dark ? "bg-orange-400/80" : "bg-orange-600/80"}`} />
                {bm}m break
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-transparent border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-4 sm:block text-right">
            {hourlyRate > 0 && (
              <div className={`text-xs font-mono mb-1 ${dark ? "text-emerald-400/80" : "text-emerald-600"}`}>
                {formatMoney((entry.billable !== false ? entry.minutes : 0) / 60 * hourlyRate)}
              </div>
            )}
            <div className={`text-xl font-mono font-bold tracking-tight bg-gradient-to-r bg-clip-text text-transparent ${
              dark ? "from-cyan-400 to-teal-400" : "from-teal-600 to-emerald-600"
            }`}>
              {formatDuration(entry.minutes)}
            </div>
          </div>
          
          <div className="flex items-center gap-1 sm:mt-3 justify-end opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => startInlineEdit(entry)}
              title="Edit"
              className="p-1.5 sm:p-2 rounded-lg transition-all text-[var(--color-accent)] hover:bg-[var(--color-accent-light)]"
            >
              <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              onClick={() => duplicateEntry(entry)}
              title="Duplicate to today"
              className={`p-1.5 sm:p-2 rounded-lg transition-all ${dark ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
            >
              <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              onClick={() => handleDelete(entry.id)}
              title="Delete"
              className={`p-1.5 sm:p-2 rounded-lg transition-all ${dark ? "text-red-400 hover:bg-red-500/10" : "text-red-500 hover:bg-red-50"}`}
            >
              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className={`absolute bottom-0 left-0 right-0 h-1 sm:h-1.5 ${dark ? "bg-slate-800/50" : "bg-slate-200/50"}`}>
        {(() => {
          const projectColor = entryProjects[0]?.color;
          const barColor = projectColor
            ? projectColor + (entry.billable !== false ? "cc" : "66")
            : entry.billable !== false
              ? dark ? "#06b6d4" : "#14b8a6"
              : dark ? "#134e4a" : "#115e59";
          const breakColor = projectColor ? projectColor + "44" : dark ? "#67e8f9" : "#99f6e4";
          return (
            <>
              <div
                className="absolute top-0 h-full"
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: barColor }}
              />
              {(entry.breaks || []).filter((b) => b.unpaid).map((b, i) => {
                const bStart = timeToHour(b.start);
                const bEnd = timeToHour(b.end);
                const bLeft = Math.max(0, ((bStart - 8) / 12) * 100);
                const bWidth = Math.max(0, ((bEnd - bStart) / 12) * 100);
                return (
                  <div
                    key={i}
                    className="absolute top-0 h-full"
                    style={{ left: `${bLeft}%`, width: `${bWidth}%`, background: breakColor }}
                  />
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}
