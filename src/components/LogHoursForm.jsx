import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import TimeSelect from "./TimeSelect";
import { calcWorked, formatDuration, formatDecimal, todayStr, toDisplayTime, makeEmptyForm, currentTimeStr } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar, Clock, Plus, Pencil, ArrowRightLeft, Check } from "lucide-react";
import ProjectPicker from "./ProjectPicker";

export default function LogHoursForm() {
  const {
    form, setForm, setField, addBreak, updateBreak, removeBreak,
    handleSubmit, applyTemplate, templates, projects, settings,
    clockIn, handleClockIn, clockedElapsed, breakElapsed,
    updateClockIn, startClockBreak, endClockBreak,
    clockOutAndFill, clockedTick, timeRounding, defaultEntryMode,
    logHoursRef, dateInputRef, deepseekKey, rewriteDescription, rewritingDesc,
    pendingEntry, updatePendingEntry, clearPendingEntry,
    currentTask, switchTask, renameCurrentTask,
  } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [mode, setMode] = useState(() => defaultEntryMode || "manual");
  const [startTime, setStartTime] = useState(() => currentTimeStr());
  // What the user is starting the clock for. Empty is fine — the
  // active segment just gets a blank description and can be edited.
  const [initialTaskDraft, setInitialTaskDraft] = useState("");
  // Inline edit / switch composer while clocked in.
  const [taskDraft, setTaskDraft] = useState("");
  const [taskEditMode, setTaskEditMode] = useState(null); // 'edit' | 'switch' | null
  const [taskBusy, setTaskBusy] = useState(false);

  const manualDescRef = useRef(null);
  const clockDescRef = useRef(null);

  useEffect(() => {
    const el = manualDescRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [form.description]);

  useEffect(() => {
    const el = clockDescRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [clockIn?.description]);

  useEffect(() => {
    if (clockIn || pendingEntry) setMode("auto");
    if (!clockIn && !pendingEntry) setStartTime(currentTimeStr());
  }, [clockIn, pendingEntry]);


  const previewMins = calcWorked(form.start, form.end, form.breaks);

  const subCardCls = `p-6 rounded-xl border transition-all ${
    dark ? "bg-slate-800/30 border-slate-700/50" : "bg-slate-50/50 border-slate-200/50"
  }`;
  
  const inputClass = `w-full px-4 py-3 rounded-lg text-sm transition-all focus:outline-none focus:ring-2 ${
    dark
      ? "bg-slate-900/50 border border-slate-700/50 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:ring-cyan-500/20"
      : "bg-white/80 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:ring-blue-100"
  }`;

  return (
    <div
      ref={logHoursRef}
      className={`relative overflow-hidden rounded-2xl border transition-all mb-8 ${
        dark
          ? "bg-slate-900/50 backdrop-blur-2xl border-cyan-500/20 shadow-[0_8px_32px_rgba(6,182,212,0.15)]"
          : "bg-white/60 backdrop-blur-xl border-blue-200/50 shadow-xl shadow-blue-500/5"
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br pointer-events-none ${
        dark ? "from-cyan-500/5 via-transparent to-purple-500/5" : "from-blue-500/5 via-transparent to-purple-500/5"
      }`} />

      <div className="relative p-5 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <h2
            className={`text-2xl font-semibold bg-gradient-to-r bg-clip-text text-transparent ${
              dark
                ? "from-cyan-400 via-teal-400 to-emerald-400"
                : "from-teal-600 to-emerald-600"
            }`}
          >
            Log Hours
          </h2>
          
          <div className={`flex p-1 rounded-lg ${dark ? "bg-slate-800/50" : "bg-slate-100/80"} border ${dark ? "border-slate-700/50" : "border-slate-200/50"}`}>
            {["manual", "auto"].map((m) => (
              <button
                key={m}
                onClick={() => !clockIn && !pendingEntry && setMode(m)}
                disabled={!!clockIn || !!pendingEntry}
                className={`px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${
                  mode === m
                    ? dark
                      ? "bg-slate-700 text-cyan-400 shadow-sm"
                      : "bg-white text-teal-600 shadow-sm border border-slate-200/50"
                    : dark
                    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
                } ${(clockIn || pendingEntry) ? "cursor-default opacity-60" : "cursor-pointer"}`}
              >
                {m === "manual" ? "Manual" : "Automatic"}
              </button>
            ))}
          </div>
        </div>

        {/* ── AUTO MODE ── */}
        {mode === "auto" && (
          <div className="py-4">

            {/* State 1: idle — not clocked in, nothing pending */}
            {!clockIn && !pendingEntry && (
              <div className="flex flex-col items-center gap-5 text-center py-6 sm:py-10">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg border-2 ${
                  dark ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400" : "bg-teal-50 border-teal-100 text-teal-600"
                }`}>
                  <Clock className="w-8 h-8" />
                </div>
                <div>
                  <p className={`text-base font-semibold mb-1 ${dark ? "text-white" : "text-slate-800"}`}>Ready to start?</p>
                  <p className={`text-sm max-w-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    Clock in to start tracking. Name the task or skip — you can change it any time.
                    {timeRounding !== "none" && ` Times will be rounded to ${timeRounding} min.`}
                  </p>
                </div>
                <div className="w-full max-w-md flex flex-col gap-3">
                  <Input
                    value={initialTaskDraft}
                    onChange={(e) => setInitialTaskDraft(e.target.value.slice(0, 200))}
                    placeholder="What are you working on? (optional)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleClockIn(startTime, initialTaskDraft.trim());
                        setInitialTaskDraft("");
                      }
                    }}
                    className={inputClass}
                  />
                  <div className="flex items-center justify-center gap-3">
                    <div className="flex flex-col items-start gap-1">
                      <label className={`text-xs font-medium uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        Started at
                      </label>
                      <TimeSelect
                        value={startTime}
                        onChange={setStartTime}
                      />
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs invisible select-none">-</span>
                      <Button
                        onClick={() => { handleClockIn(startTime, initialTaskDraft.trim()); setInitialTaskDraft(""); }}
                        className={`px-8 py-2.5 rounded-xl text-sm font-semibold shadow-lg transition-all ${
                          dark
                            ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:from-cyan-400 hover:to-teal-400"
                            : "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-teal-500/30 hover:from-teal-700 hover:to-emerald-700"
                        }`}
                      >
                        Clock In
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* State 2: actively clocked in */}
            {clockIn && (
              <div className="flex flex-col gap-5">
                <div className={`p-5 sm:p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 border ${
                  dark ? "bg-cyan-950/30 border-cyan-500/20" : "bg-teal-50 border-teal-100"
                }`}>
                  <div>
                    <p className={`text-3xl sm:text-4xl font-bold font-mono leading-none tracking-tight mb-2 ${
                      dark ? "text-cyan-400" : "text-teal-600"
                    }`}>
                      {clockedElapsed()}
                    </p>
                    <p className={`text-xs sm:text-sm font-medium ${dark ? "text-cyan-400/70" : "text-teal-700/70"}`}>
                      Clocked in at {toDisplayTime(clockIn.start)}
                      {clockIn.date !== todayStr() ? ` · ${clockIn.date}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button
                      onClick={clockIn?.activeBreak ? endClockBreak : startClockBreak}
                      variant="outline"
                      className={`flex-1 sm:flex-none px-5 py-2.5 h-auto rounded-xl text-sm font-semibold transition-all ${
                        clockIn?.activeBreak
                          ? dark ? "border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border" : "border-orange-400 text-orange-700 bg-orange-50 hover:bg-orange-100 border"
                          : dark ? "border-slate-600 text-slate-300 bg-slate-800/40 hover:bg-slate-700/60 border" : "border-slate-300 text-slate-700 bg-slate-50 hover:bg-slate-100 border"
                      }`}
                    >
                      {clockIn?.activeBreak ? "End Break" : "Break"}
                    </Button>
                    <Button
                      onClick={clockOutAndFill}
                      className={`flex-1 sm:flex-none px-6 py-2.5 h-auto rounded-xl text-sm font-semibold shadow-lg transition-all ${
                        dark
                          ? "bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-red-500/20 hover:shadow-red-500/40 hover:from-red-400 hover:to-orange-400 border-none"
                          : "bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-red-500/20 hover:from-red-700 hover:to-orange-700 border-none"
                      }`}
                    >
                      Clock Out
                    </Button>
                  </div>
                </div>

                {/* Current task card — the task the open segment is
                    against. Editing the name renames the open segment;
                    Switch closes it and opens a new one with a new name. */}
                <div className={subCardCls}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 className={`text-xs font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      Current task
                    </h3>
                    {currentTask?.started_at && (
                      <span className={`text-[11px] font-mono ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        since {toDisplayTime(new Date(currentTask.started_at).toTimeString().slice(0, 5))}
                      </span>
                    )}
                  </div>
                  {taskEditMode ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={taskDraft}
                        onChange={(e) => setTaskDraft(e.target.value.slice(0, 200))}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const next = taskDraft.trim();
                            setTaskBusy(true);
                            if (taskEditMode === "switch") await switchTask(next);
                            else await renameCurrentTask(next);
                            setTaskBusy(false);
                            setTaskEditMode(null);
                          }
                          if (e.key === "Escape") setTaskEditMode(null);
                        }}
                        placeholder={taskEditMode === "switch" ? "What are you switching to?" : "Name this task"}
                        className={inputClass}
                      />
                      <Button
                        type="button"
                        onClick={async () => {
                          const next = taskDraft.trim();
                          setTaskBusy(true);
                          if (taskEditMode === "switch") await switchTask(next);
                          else await renameCurrentTask(next);
                          setTaskBusy(false);
                          setTaskEditMode(null);
                        }}
                        disabled={taskBusy}
                        className="h-10"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className={`flex-1 text-base font-semibold truncate ${
                        currentTask?.description
                          ? dark ? "text-white" : "text-slate-800"
                          : dark ? "text-slate-500 italic" : "text-slate-400 italic"
                      }`}>
                        {currentTask?.description || "Untitled task — click edit to name it"}
                      </p>
                      <button
                        type="button"
                        onClick={() => { setTaskDraft(currentTask?.description || ""); setTaskEditMode("edit"); }}
                        title="Edit name"
                        className={`p-2 rounded-md transition-colors ${
                          dark ? "text-slate-400 hover:bg-slate-700/60 hover:text-slate-200" : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                        }`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setTaskDraft(""); setTaskEditMode("switch"); }}
                        title="Switch task"
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${
                          dark ? "bg-slate-800 text-cyan-300 hover:bg-slate-700" : "bg-slate-100 text-teal-700 hover:bg-slate-200"
                        }`}
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        Switch
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 mt-2">
                  <div className={subCardCls}>
                    <div className="flex items-center gap-2 mb-4">
                      <Clock className={`w-5 h-5 ${dark ? "text-teal-400" : "text-teal-600"}`} />
                      <h3 className={`font-semibold ${dark ? "text-white" : "text-slate-800"}`}>Details</h3>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <Textarea
                          ref={clockDescRef}
                          value={clockIn.description || ""}
                          onChange={(e) => {
                            updateClockIn({ description: e.target.value });
                            e.target.style.height = "auto";
                            e.target.style.height = e.target.scrollHeight + "px";
                          }}
                          placeholder="What are you working on?"
                          className={`${inputClass} resize-none overflow-hidden min-h-[80px]`}
                        />
                        {deepseekKey && (
                          <button
                            onClick={() => rewriteDescription(clockIn.description, (v) => updateClockIn({ description: v }))}
                            disabled={rewritingDesc || !clockIn.description?.trim()}
                            className={`mt-1.5 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              dark
                                ? "bg-slate-800/80 border-slate-700 text-cyan-400 hover:enabled:bg-slate-700 hover:enabled:border-cyan-500/50"
                                : "bg-white/80 border-slate-200 text-teal-600 hover:enabled:bg-slate-50 hover:enabled:border-teal-300"
                            }`}
                          >
                            {rewritingDesc ? (<><span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" /> Rewriting</>) : "✦ Rewrite"}
                          </button>
                        )}
                      </div>
                      <ProjectPicker
                        selectedIds={clockIn.projectIds || []}
                        onChange={(ids) => updateClockIn({ projectIds: ids })}
                      />
                      <label className="flex items-center gap-2 cursor-pointer mt-3">
                        <Checkbox id="clock-billable" checked={clockIn.billable !== false}
                          onCheckedChange={(v) => updateClockIn({ billable: !!v })}
                          className={`w-5 h-5 rounded border-2 cursor-pointer transition-all ${dark ? "border-slate-700 data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-cyan-500 data-[state=checked]:to-teal-500 data-[state=checked]:border-cyan-500" : "border-slate-300 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"}`}
                        />
                        <span className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-600"}`}>Billable</span>
                      </label>
                    </div>
                  </div>
                  {(clockIn.breaks || []).length > 0 && (
                    <div className={subCardCls}>
                      <span className={`text-sm font-semibold ${dark ? "text-slate-400" : "text-slate-600"}`}>Breaks</span>
                      <div className="space-y-2 mt-3">
                        {(clockIn.breaks || []).map((b) => {
                          const mins = (b.end.split(":").reduce((a, v, i) => a + (i === 0 ? +v * 60 : +v), 0)) - (b.start.split(":").reduce((a, v, i) => a + (i === 0 ? +v * 60 : +v), 0));
                          return (
                            <div key={b.id} className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-medium ${dark ? "bg-slate-800/50 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${dark ? "bg-slate-500" : "bg-slate-400"}`} />
                              {toDisplayTime(b.start)} – {toDisplayTime(b.end)}
                              <span className={`ml-auto text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>({mins}m)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {clockIn.activeBreak && (
                    <div className={`p-4 rounded-xl border ${dark ? "bg-orange-500/10 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
                      <p className={`font-semibold ${dark ? "text-orange-400" : "text-orange-700"}`}>On break · {breakElapsed()}</p>
                      <p className={`text-xs mt-0.5 ${dark ? "text-orange-400/60" : "text-orange-700/60"}`}>Started at {toDisplayTime(clockIn.activeBreak.start)}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* State 3: session ended — review & save */}
            {!clockIn && pendingEntry && (
              <div className="flex flex-col gap-4">
                {/* Session summary */}
                <div className={`p-5 sm:p-6 rounded-xl border ${dark ? "bg-slate-800/40 border-slate-700/50" : "bg-slate-50/80 border-slate-200"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <svg className={`w-4 h-4 ${dark ? "text-teal-400" : "text-teal-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className={`text-xs font-semibold uppercase tracking-wider ${dark ? "text-teal-400/80" : "text-teal-600/80"}`}>Session complete</span>
                  </div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className={`text-3xl sm:text-4xl font-bold font-mono ${dark ? "text-white" : "text-slate-800"}`}>
                      {formatDuration(pendingEntry.minutes)}
                    </span>
                    <span className={`text-sm font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {toDisplayTime(pendingEntry.start)} – {toDisplayTime(pendingEntry.end)}
                    </span>
                  </div>
                  {(pendingEntry.breaks || []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {pendingEntry.breaks.map((b) => {
                        const mins = (b.end.split(":").reduce((a, v, i) => a + (i === 0 ? +v * 60 : +v), 0)) - (b.start.split(":").reduce((a, v, i) => a + (i === 0 ? +v * 60 : +v), 0));
                        return (
                          <span key={b.id} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${dark ? "bg-slate-700/50 border-slate-600 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"}`}>
                            break {toDisplayTime(b.start)}–{toDisplayTime(b.end)} ({mins}m)
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Editable details */}
                <div className={subCardCls}>
                  <div className="space-y-4">
                    <div>
                      <Textarea
                        value={pendingEntry.description || ""}
                        onChange={(e) => updatePendingEntry({ description: e.target.value })}
                        placeholder="What did you work on?"
                        className={`${inputClass} resize-none overflow-hidden min-h-[80px]`}
                        onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                      />
                      {deepseekKey && (
                        <button
                          onClick={() => rewriteDescription(pendingEntry.description, (v) => updatePendingEntry({ description: v }))}
                          disabled={rewritingDesc || !pendingEntry.description?.trim()}
                          className={`mt-1.5 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "bg-slate-800/80 border-slate-700 text-cyan-400 hover:enabled:bg-slate-700 hover:enabled:border-cyan-500/50" : "bg-white/80 border-slate-200 text-teal-600 hover:enabled:bg-slate-50 hover:enabled:border-teal-300"}`}
                        >
                          {rewritingDesc ? (<><span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" /> Rewriting</>) : "✦ Rewrite"}
                        </button>
                      )}
                    </div>
                    <ProjectPicker
                      selectedIds={pendingEntry.projectIds || []}
                      onChange={(ids) => updatePendingEntry({ projectIds: ids })}
                    />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox id="pending-billable" checked={pendingEntry.billable !== false}
                        onCheckedChange={(v) => updatePendingEntry({ billable: !!v })}
                        className={`w-5 h-5 rounded border-2 cursor-pointer transition-all ${dark ? "border-slate-700 data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-cyan-500 data-[state=checked]:to-teal-500 data-[state=checked]:border-cyan-500" : "border-slate-300 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"}`}
                      />
                      <span className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-600"}`}>Billable</span>
                    </label>
                  </div>
                </div>

                {/* Actions */}
                <div className={`flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2`}>
                  <Button
                    onClick={() => { handleSubmit(pendingEntry); clearPendingEntry(); }}
                    disabled={!pendingEntry.date || !pendingEntry.start || !pendingEntry.end}
                    className={`flex-1 py-3 h-auto rounded-xl text-sm font-semibold shadow-lg transition-all disabled:opacity-50 ${
                      dark
                        ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:from-cyan-400 hover:to-teal-400 border-none"
                        : "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-teal-500/30 hover:from-teal-700 hover:to-emerald-700 border-none"
                    }`}
                  >
                    Save Entry
                  </Button>
                  <button
                    onClick={() => { clearPendingEntry(); handleClockIn(); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      dark ? "border-slate-600 text-slate-300 hover:border-slate-500 hover:text-white" : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
                    }`}
                  >
                    Clock In Again
                  </button>
                  <button
                    onClick={clearPendingEntry}
                    className={`sm:w-auto py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
                      dark ? "text-slate-500 hover:text-slate-400" : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── MANUAL MODE ── */}
        {mode === "manual" && (
          <div className="flex flex-col gap-4 sm:gap-6 mt-2">
            
            {/* Template picker */}
            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className={`text-xs font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>Templates</p>
                <div className="flex items-center gap-2 flex-wrap pb-2 mb-2 border-b border-transparent">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                        dark
                          ? "bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-700 hover:border-cyan-500/30 hover:text-cyan-400"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 shadow-sm"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4">

              {/* Date & Time block */}
              <div className={subCardCls}>
                <div className="flex items-center gap-2 mb-5">
                  <Calendar className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-blue-600"}`} />
                  <h3 className={`font-semibold ${dark ? "text-white" : "text-slate-800"}`}>Date & Time</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>Date</label>
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={form.date}
                      onChange={(e) => setField("date", e.target.value)}
                      className={inputClass}
                      onFocus={(e) => { e.currentTarget.style.borderColor = dark ? "var(--color-cyan-500)" : "var(--color-blue-400)" }}
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>Start</label>
                      <TimeSelect value={form.start} onChange={(v) => setField("start", v)} />
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1.5 uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>End</label>
                      <TimeSelect value={form.end} onChange={(v) => setField("end", v)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Details block */}
              <div className={subCardCls}>
                <div className="flex items-center gap-2 mb-5">
                  <Clock className={`w-5 h-5 ${dark ? "text-teal-400" : "text-teal-600"}`} />
                  <h3 className={`font-semibold ${dark ? "text-white" : "text-slate-800"}`}>Details</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <Textarea
                      ref={manualDescRef}
                      value={form.description}
                      onChange={(e) => {
                        setField("description", e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                      }}
                      placeholder="What did you work on?"
                      className={`${inputClass} resize-none overflow-hidden min-h-[80px]`}
                    />
                    {deepseekKey && (
                      <button
                        onClick={() => rewriteDescription()}
                        disabled={rewritingDesc || !form.description.trim()}
                        className={`mt-1.5 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                          dark
                            ? "bg-slate-800/80 border-slate-700 text-cyan-400 hover:enabled:bg-slate-700 hover:enabled:border-cyan-500/50"
                            : "bg-white/80 border-slate-200 text-teal-600 hover:enabled:bg-slate-50 hover:enabled:border-teal-300"
                        }`}
                      >
                        {rewritingDesc ? (
                          <><span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" /> Rewriting</>
                        ) : "✦ Rewrite"}
                      </button>
                    )}
                  </div>

                  <ProjectPicker
                    selectedIds={form.projectIds || []}
                    onChange={(ids) => setField("projectIds", ids)}
                  />
                </div>
              </div>
            </div>

            {/* Breaks */}
            {form.breaks.length > 0 && (
              <div className="mt-2">
                <h3 className={`text-sm font-semibold mb-3 ${dark ? "text-slate-300" : "text-slate-700"}`}>Breaks</h3>
                <div className="space-y-2">
                  {form.breaks.map((b) => (
                    <div
                      key={b.id}
                      className={`p-3 rounded-lg border space-y-3 transition-all ${
                        dark ? "bg-slate-800/20 border-slate-700/50" : "bg-slate-50/50 border-slate-200/50"
                      }`}
                    >
                      {/* Stack on mobile, side by side on sm+ */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={`block text-xs uppercase font-medium tracking-wide mb-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>From</label>
                          <TimeSelect value={b.start} onChange={(v) => updateBreak(b.id, { start: v })} />
                        </div>
                        <div>
                          <label className={`block text-xs uppercase font-medium tracking-wide mb-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>To</label>
                          <TimeSelect value={b.end} onChange={(v) => updateBreak(b.id, { end: v })} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            id={`u-${b.id}`}
                            checked={b.unpaid}
                            onCheckedChange={(v) => updateBreak(b.id, { unpaid: !!v })}
                            className={`w-4 h-4 rounded-sm border transition-all ${
                              dark
                                ? "border-slate-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                : "border-slate-300 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                            }`}
                          />
                          <span className={`text-xs font-medium ${dark ? "text-slate-400" : "text-slate-600"}`}>Unpaid</span>
                        </label>
                        
                        <button
                          onClick={() => removeBreak(b.id)}
                          className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                            dark ? "text-red-400 hover:text-red-300 hover:bg-red-500/10" : "text-red-600 hover:text-red-700 hover:bg-red-50"
                          }`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom Action Bar */}
            <div className={`mt-4 pt-6 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${dark ? "border-slate-800/60" : "border-slate-200"}`}>
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id="form-billable"
                    checked={form.billable !== false}
                    onCheckedChange={(v) => setField("billable", !!v)}
                    className={`w-5 h-5 rounded border-2 transition-all ${
                      dark
                        ? "border-slate-700 data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-cyan-500 data-[state=checked]:to-teal-500 data-[state=checked]:border-cyan-500"
                        : "border-slate-300 data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                    }`}
                  />
                  <span className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-600"}`}>Billable</span>
                </label>
                <div className={`w-px h-5 ${dark ? "bg-slate-700" : "bg-slate-200"} hidden sm:block`} />
                <button
                  onClick={addBreak}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    dark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50" : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Add break</span>
                  <span className="sm:hidden">Break</span>
                </button>
              </div>

              <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                <div className="font-mono flex-1 sm:flex-none">
                  {form.start && form.end ? (
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl sm:text-2xl font-semibold bg-gradient-to-r bg-clip-text text-transparent ${
                        dark ? "from-cyan-400 via-teal-400 to-emerald-400" : "from-teal-600 to-emerald-600"
                      }`}>
                        {formatDuration(previewMins)}
                      </span>
                      <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        ({formatDecimal(previewMins)}h)
                      </span>
                    </div>
                  ) : (
                    <span className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>Enter times</span>
                  )}
                </div>
                
                <button
                  onClick={() => setForm(makeEmptyForm(settings, templates))}
                  className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                    dark ? "border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300" : "border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
                  }`}
                >
                  Clear
                </button>
                <Button
                  onClick={() => handleSubmit(form)}
                  disabled={!form.date || !form.start || !form.end}
                  className={`px-6 sm:px-8 py-2.5 sm:py-3 h-auto rounded-xl text-sm sm:text-base font-semibold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    dark
                      ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:from-cyan-400 hover:to-teal-400"
                      : "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-teal-500/30 hover:from-teal-700 hover:to-emerald-700"
                  } border-none`}
                >
                  Log Hours
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
