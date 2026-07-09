import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { todayStr, tomorrowStr, formatDateLabel, offsetDateStr } from "../lib/utils";
import {
  listSubtasks,
  addSubtask as addSubtaskRow,
  addSubtasks as addSubtaskRows,
  setSubtaskDone,
  deleteSubtask as deleteSubtaskRow,
  subtaskProgress,
} from "../lib/subtasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Focus,
  Trash2,
  Sparkles,
  Trophy,
  X,
  Plus,
  Loader2,
  ListChecks,
} from "lucide-react";
import { Skeleton, SkeletonCard } from "../components/Skeleton";

const LS_PLANNER_COLLAPSED_GROUPS = "sw_planner_collapsed_project_groups";

function readCollapsedGroupKeys() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LS_PLANNER_COLLAPSED_GROUPS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistCollapsedGroupKeys(set) {
  try {
    localStorage.setItem(LS_PLANNER_COLLAPSED_GROUPS, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function CollapsibleProjectGroup({
  groupId,
  heading,
  color,
  taskCount,
  dark,
  collapsed,
  onToggle,
  children,
}) {
  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        dark ? "border-slate-700/55 bg-[var(--color-bg)]/30 shadow-sm" : "border-slate-200/90 bg-white/70 shadow-sm"
      }`}
    >
      <button
        type="button"
        className={`w-full flex items-center gap-3 px-3 py-3 sm:px-4 text-left transition-colors ${
          dark ? "hover:bg-slate-800/45" : "hover:bg-slate-50/90"
        }`}
        onClick={() => onToggle(groupId)}
        aria-expanded={!collapsed}
      >
        <span className={`shrink-0 transition-transform duration-200 ease-out ${collapsed ? "" : "rotate-90"}`}>
          <ChevronRight className={`w-4 h-4 ${dark ? "text-slate-400" : "text-slate-500"}`} aria-hidden />
        </span>
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-black/5 dark:ring-white/10"
          style={{ background: color || (dark ? "#64748b" : "#94a3b8") }}
        />
        <span
          className={`flex-1 text-[11px] sm:text-xs font-semibold uppercase tracking-wide min-w-0 truncate ${
            dark ? "text-slate-200" : "text-slate-700"
          }`}
        >
          {heading}
        </span>
        <span className={`text-[11px] tabular-nums shrink-0 ${dark ? "text-slate-500" : "text-slate-500"}`}>{taskCount}</span>
      </button>
      {!collapsed && (
        <div className={`border-t px-2 py-2 sm:px-3 sm:pb-3 ${dark ? "border-[var(--color-border-light)]" : "border-slate-200/90"}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** How many calendar days of unfinished tasks to show under "Earlier"; older unchecked tasks are removed. */
const PLANNER_HISTORY_DAYS = 5;
/** Load future tasks up to this many days ahead. */
const PLANNER_FUTURE_DAYS = 90;

const PRIORITY_OPTIONS = [
  { value: "0", label: "No priority" },
  { value: "1", label: "Low priority" },
  { value: "2", label: "Medium priority" },
  { value: "3", label: "High priority" },
];

function normalizePlannerTask(row) {
  return {
    id: row.id,
    plannerDate: row.planner_date ?? null,
    title: (row.title || "").trim(),
    notes: typeof row.notes === "string" ? row.notes.trim() : "",
    projectId: row.project_id ?? null,
    done: row.done === true,
    inProgress: row.in_progress === true,
    sortOrder: row.sort_order ?? 0,
    priority: Math.min(3, Math.max(0, Number(row.priority) || 0)),
    progress: Math.min(100, Math.max(0, Number(row.progress) || 0)),
    pointsAwardedForTask: Math.max(0, Number(row.points_awarded_for_task) || 0),
  };
}

function sortTasksForDisplay(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
}

/** Group sorted tasks by project for display; unassigned last; project names A–Z. */
function groupPlannerTasksByProject(tasks, projectList) {
  const byId = new Map(projectList.map((p) => [p.id, p]));
  const sorted = sortTasksForDisplay(tasks);
  const m = new Map();
  for (const t of sorted) {
    const pid = t.projectId ?? null;
    if (!m.has(pid)) m.set(pid, []);
    m.get(pid).push(t);
  }
  const entries = [...m.entries()].filter(([, list]) => list.length > 0);
  entries.sort((a, b) => {
    if (a[0] === null) return 1;
    if (b[0] === null) return -1;
    const na = byId.get(a[0])?.name ?? "\uffff";
    const nb = byId.get(b[0])?.name ?? "\uffff";
    return na.localeCompare(nb);
  });
  return entries.map(([pid, list]) => {
    const p = pid ? byId.get(pid) : null;
    return {
      key: pid ?? "__none__",
      heading: pid ? (p?.name ?? "Project") : "No project",
      color: p?.color ?? null,
      tasks: list,
    };
  });
}

/** Max points when a task is fully complete (depends on priority). */
function pointsForComplete(priority) {
  const p = Math.min(3, Math.max(0, priority | 0));
  return 10 + p * 5;
}

function clampProgress(n) {
  const v = Math.round(Number(n));
  return Math.min(100, Math.max(0, v));
}

/**
 * Target points credited for this task. Incomplete tasks cap at 99% of max so the last slice
 * only applies when the task is checked complete.
 */
function targetCreditedForTask(done, progress, priority) {
  const max = pointsForComplete(priority);
  if (done) return max;
  const p = Math.min(99, clampProgress(progress));
  return Math.floor((max * p) / 100);
}

/** When AI is off, split on semicolons or newlines into suggestion lines. */
function heuristicBreakdown(text) {
  const raw = text.split(/[;\n]|(?:\s*\/\s*)/).map((s) => s.trim()).filter(Boolean);
  return raw.length > 1 ? raw.slice(0, 10) : null;
}

/** Destinations for the Move control: Today, Tomorrow, and Backlog when the task has a date. */
function getMoveDestinations(task, today, tomorrow) {
  const d = task.plannerDate;
  const opts = [];
  if (d !== today) opts.push({ value: "today", label: "Today", targetDate: today });
  if (d !== tomorrow) opts.push({ value: "tomorrow", label: "Tomorrow", targetDate: tomorrow });
  if (d != null) opts.push({ value: "backlog", label: "Backlog", targetDate: null });
  return opts;
}

/**
 * Collapsible subtask checklist for a planner task: check/add/delete + AI
 * generate. Parent progress derives from these (handled by the page). Self-
 * contained AI suggestion flow (mirrors the page-level breakdown selection UI).
 */
function SubtaskSection({ task, subtasks, dark, disabled, onAddSubtask, onAddAiSubtasks, onToggleSubtask, onDeleteSubtask }) {
  const { suggestSubtasks, deepseekKey } = useApp();
  const subs = subtasks || [];
  const { done, total } = subtaskProgress(subs);
  const [newSub, setNewSub] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // null hidden; [] none
  const [selected, setSelected] = useState([]);

  const inputCls = dark
    ? "bg-[var(--color-bg)] border-slate-600/90 text-slate-100"
    : "bg-white border-slate-200 text-slate-900";

  async function submitNew(e) {
    e?.preventDefault?.();
    const v = newSub.trim();
    if (!v) return;
    setNewSub("");
    await onAddSubtask(task, v);
  }

  async function runAi() {
    setAiBusy(true);
    try {
      const titles = await suggestSubtasks(task.title, task.notes);
      if (!titles?.length) {
        setSuggestions([]);
        return;
      }
      setSuggestions(titles);
      setSelected(titles.map(() => true));
    } finally {
      setAiBusy(false);
    }
  }

  async function addSelected() {
    const titles = (suggestions || []).filter((_, i) => selected[i]);
    if (!titles.length) {
      setSuggestions(null);
      return;
    }
    await onAddAiSubtasks(task, titles);
    setSuggestions(null);
    setSelected([]);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>Subtasks</span>
        {total > 0 && (
          <span className={`text-[11px] tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>{done}/{total}</span>
        )}
        {deepseekKey && (
          <button
            type="button"
            onClick={runAi}
            disabled={disabled || aiBusy}
            title="Generate subtasks with AI"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:opacity-80 disabled:opacity-50"
          >
            {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Suggest
          </button>
        )}
      </div>

      {subs.length > 0 && (
        <ul>
          {subs.map((s) => (
            <li key={s.id} className={`flex items-center gap-2 group -mx-1 px-1 py-1 rounded-md ${dark ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]"}`}>
              <Checkbox
                checked={s.done}
                onCheckedChange={() => onToggleSubtask(task, s)}
                disabled={disabled}
                className="shrink-0"
                aria-label={s.done ? "Mark subtask not done" : "Mark subtask done"}
              />
              <span className={`flex-1 text-[13px] leading-snug ${s.done ? "line-through opacity-50" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>
                {s.title}
              </span>
              <button
                type="button"
                onClick={() => onDeleteSubtask(task, s)}
                disabled={disabled}
                className={`shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${dark ? "text-slate-500 hover:text-red-400" : "text-slate-400 hover:text-red-600"}`}
                title="Delete subtask"
                aria-label="Delete subtask"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions !== null && (
        <div className={`rounded-lg border p-2 space-y-1.5 ${dark ? "border-slate-600/70 bg-[var(--color-bg)]/40" : "border-slate-200 bg-white"}`}>
          {suggestions.length === 0 ? (
            <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
              No suggestions — add a DeepSeek key in Settings, or add subtasks manually.
            </p>
          ) : (
            <>
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}>Suggested</p>
              {suggestions.map((title, i) => (
                <label key={i} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selected[i]}
                    onCheckedChange={(v) => setSelected((prev) => prev.map((p, j) => (j === i ? !!v : p)))}
                    className="shrink-0"
                  />
                  <span className={`text-[13px] ${dark ? "text-slate-200" : "text-slate-700"}`}>{title}</span>
                </label>
              ))}
              <div className="flex gap-1.5 pt-0.5">
                <Button type="button" size="sm" className="h-7 px-2.5 text-[11px]" onClick={addSelected} disabled={disabled}>
                  Add selected
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => setSuggestions(null)}>
                  Dismiss
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <form onSubmit={submitNew} className="flex items-center gap-1.5">
        <Input
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          placeholder="Add a subtask…"
          disabled={disabled}
          className={`h-8 text-[13px] ${inputCls}`}
        />
        <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={disabled || !newSub.trim()} aria-label="Add subtask">
          <Plus className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

function PlannerTaskRow({
  t,
  dark,
  disabled,
  showDateBadge,
  dateBadgeStr,
  onToggleDone,
  onDelete,
  onSetFocus,
  moveDestinations,
  onMoveToDate,
  onPriorityChange,
  onProgressChange,
  onNotesChange,
  onProjectChange,
  projects,
  maxPoints,
  reorder,
  subtasks,
  onAddSubtask,
  onAddAiSubtasks,
  onToggleSubtask,
  onDeleteSubtask,
}) {
  const inputCls = dark
    ? "bg-[var(--color-bg)] border-slate-600/90 text-slate-100"
    : "bg-white border-slate-200 text-slate-900";

  const subs = subtasks || [];
  const hasSubtasks = subs.length > 0;
  const subProg = subtaskProgress(subs);
  const committedPct = Math.min(99, t.progress);
  const [dragPct, setDragPct] = useState(null);
  const sliderShown = dragPct !== null ? dragPct : committedPct;
  const [noteDraft, setNoteDraft] = useState(t.notes);

  useEffect(() => {
    setDragPct(null);
  }, [committedPct, t.id]);

  useEffect(() => {
    setNoteDraft(t.notes);
  }, [t.id, t.notes]);

  const pri = t.priority | 0;
  const priMeta = [
    null,
    { label: "Low", dot: "bg-slate-400" },
    { label: "Med", dot: "bg-amber-500" },
    { label: "High", dot: "bg-rose-500" },
  ][Math.min(3, Math.max(0, pri))];

  const complete = t.done;
  const headerPct = hasSubtasks ? subProg.pct : committedPct;
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(!!t.notes?.trim());
  // Manual slider shows only when there are no subtasks to derive from; when it
  // does, it owns the progress readout so the header bar/% don't duplicate it.
  const showManualProgress = !complete && !hasSubtasks;
  const showHeaderProgress = !complete && !(expanded && showManualProgress);

  const softBtn = dark
    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100";

  return (
    <li
      className={`group rounded-xl border transition-all ${
        t.inProgress && !complete
          ? dark
            ? "border-[var(--color-accent)]/70 bg-[var(--color-accent-light)]/25"
            : "border-[var(--color-accent)]/60 bg-[var(--color-accent-light)]/40"
          : dark
            ? "border-slate-700/70 bg-[var(--color-bg)]/40 hover:border-slate-600/90"
            : "border-slate-200/90 bg-white hover:border-slate-300"
      }`}
    >
      {/* Header — compact, click title/chevron to expand */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Checkbox
          checked={t.done}
          onCheckedChange={() => onToggleDone(t)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
          disabled={disabled}
          aria-label={t.done ? "Mark not done" : "Mark done"}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-sm font-medium leading-snug ${complete ? "line-through opacity-55" : ""} ${
                dark ? "text-slate-100" : "text-slate-900"
              }`}
            >
              {t.title || "(empty)"}
            </span>
            {t.inProgress && !complete && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-light)]">
                <Focus className="w-2.5 h-2.5" /> Focus
              </span>
            )}
          </div>
          <div className={`flex items-center gap-x-2.5 gap-y-0.5 flex-wrap mt-1 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {priMeta && (
              <span className="inline-flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${priMeta.dot}`} />
                {priMeta.label}
              </span>
            )}
            {hasSubtasks && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ListChecks className="w-3 h-3" />
                {subProg.done}/{subProg.total}
              </span>
            )}
            <span className={`tabular-nums ${complete ? (dark ? "text-emerald-400/90" : "text-emerald-700") : dark ? "text-amber-200/80" : "text-amber-700/90"}`}>
              {t.pointsAwardedForTask}/{maxPoints} pts
            </span>
            {showDateBadge && dateBadgeStr && <span className="tabular-nums">{dateBadgeStr}</span>}
          </div>
        </button>
        {showHeaderProgress && (
          <span className={`shrink-0 text-[11px] tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>{headerPct}%</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`shrink-0 p-1 rounded-md transition-colors ${softBtn}`}
          aria-label={expanded ? "Collapse task" : "Expand task"}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Thin at-a-glance progress bar */}
      {showHeaderProgress && (
        <div className={`mx-3 -mt-1 mb-2.5 h-1 rounded-full overflow-hidden ${dark ? "bg-slate-700/50" : "bg-slate-100"}`}>
          <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${headerPct}%` }} />
        </div>
      )}

      {/* Expanded editing panel — clean zones, generous spacing */}
      {expanded && (
        <div className={`px-3.5 pb-3.5 pt-3 space-y-4 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-100"}`}>
          {/* Manual progress — fallback only when there are no subtasks. */}
          {showManualProgress && (
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>Progress</span>
              <input
                type="range"
                min={0}
                max={99}
                step={1}
                value={sliderShown}
                disabled={disabled}
                onInput={(e) => setDragPct(Number(e.target.value))}
                onPointerUp={async (e) => {
                  const v = Number(e.currentTarget.value);
                  try {
                    await onProgressChange(t, v);
                  } finally {
                    setDragPct(null);
                  }
                }}
                onPointerCancel={() => setDragPct(null)}
                onKeyUp={async (e) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
                    try {
                      await onProgressChange(t, Number(e.currentTarget.value));
                    } finally {
                      setDragPct(null);
                    }
                  }
                }}
                className={`flex-1 h-1.5 rounded-full cursor-pointer disabled:opacity-50 ${dark ? "accent-cyan-500" : "accent-teal-600"}`}
                aria-label="Task progress percent"
              />
              <span className={`text-[11px] tabular-nums w-8 text-right shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{sliderShown}%</span>
            </div>
          )}

          {/* Subtasks — the primary way to break down + track work. */}
          {!complete && (
            <SubtaskSection
              task={t}
              subtasks={subs}
              dark={dark}
              disabled={disabled}
              onAddSubtask={onAddSubtask}
              onAddAiSubtasks={onAddAiSubtasks}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
            />
          )}

          {/* Notes — tucked behind a link until you need them. */}
          {showNotes ? (
            <Textarea
              id={`task-note-${t.id}`}
              rows={2}
              placeholder="What's left, blockers, next steps…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={disabled}
              className={`text-[13px] min-h-[44px] resize-y ${inputCls}`}
              onBlur={() => onNotesChange(t, noteDraft)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
            >
              <Plus className="w-3 h-3" /> Add note
            </button>
          )}

          {/* Metadata + actions footer. */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Select value={String(t.priority)} onValueChange={(v) => onPriorityChange(t, Number(v))} disabled={disabled || complete}>
              <SelectTrigger className={`h-8 w-[132px] text-xs ${inputCls}`} aria-label="Priority">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={t.projectId ?? "__none__"} onValueChange={(v) => onProjectChange(t, v === "__none__" ? null : v)} disabled={disabled}>
              <SelectTrigger className={`h-8 w-[132px] text-xs ${inputCls}`} aria-label="Project">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-0.5 ml-auto">
              {!complete && (
                <Button type="button" variant={t.inProgress ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1.5" title="Mark as what you are working on now" onClick={() => onSetFocus(t)} disabled={disabled}>
                  <Focus className="w-3.5 h-3.5" />
                  Focus
                </Button>
              )}
              {!complete && onMoveToDate && moveDestinations && moveDestinations.length > 0 && (
                <Select
                  key={`mv-${t.id}-${String(t.plannerDate)}`}
                  onValueChange={(value) => {
                    const opt = moveDestinations.find((o) => o.value === value);
                    if (opt) onMoveToDate(t, opt.targetDate);
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger className={`h-8 w-[104px] text-xs ${inputCls}`} aria-label="Move task to">
                    <SelectValue placeholder="Move to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {moveDestinations.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {reorder && (
                <>
                  <Button type="button" variant="ghost" size="icon" className={`h-8 w-8 ${softBtn}`} title="Move up in list" disabled={disabled || !reorder.canUp} onClick={() => reorder.onReorder("up")} aria-label="Move task up">
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className={`h-8 w-8 ${softBtn}`} title="Move down in list" disabled={disabled || !reorder.canDown} onClick={() => reorder.onReorder("down")} aria-label="Move task down">
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${dark ? "text-slate-400 hover:text-red-400" : "text-slate-500 hover:text-red-600"}`}
                title="Remove task"
                onClick={() => onDelete(t.id)}
                disabled={disabled}
                aria-label="Delete task"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function PlannerPage() {
  const { session, flash, breakdownPlannerTask, projects } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const userId = session?.user?.id;

  const [items, setItems] = useState([]);
  /** parentTaskId -> subtasks[] (sorted). */
  const [subtasksByTask, setSubtasksByTask] = useState({});
  const [totalPoints, setTotalPoints] = useState(0);
  /** Background planner fetch — never hide the page. */
  const [plannerSyncing, setPlannerSyncing] = useState(false);
  const [newCurrent, setNewCurrent] = useState("");
  const [newFuture, setNewFuture] = useState("");
  const [newBacklog, setNewBacklog] = useState("");
  const [saving, setSaving] = useState(false);
  const [breakingDown, setBreakingDown] = useState(false);
  /** Describe a larger task for AI; separate from quick-add task title. */
  const [breakdownBrief, setBreakdownBrief] = useState("");
  /** Suggested step titles after "Get suggestions"; null means hidden. */
  const [breakdownSteps, setBreakdownSteps] = useState(null);
  const [breakdownSelected, setBreakdownSelected] = useState([]);
  /** Default project for newly added planner tasks (quick add, AI steps). */
  const [defaultProjectId, setDefaultProjectId] = useState(null);
  /** Keys in this set = collapsed project groups (persisted). */
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState(() => readCollapsedGroupKeys());

  const today = todayStr();
  const tomorrow = tomorrowStr();
  const historyStart = offsetDateStr(today, -PLANNER_HISTORY_DAYS);
  const futureEnd = offsetDateStr(today, PLANNER_FUTURE_DAYS);

  const todayTasks = useMemo(() => items.filter((t) => t.plannerDate === today), [items, today]);
  const previousTasks = useMemo(() => {
    return items.filter(
      (t) =>
        t.plannerDate != null &&
        t.plannerDate < today &&
        t.plannerDate >= historyStart &&
        !t.done,
    );
  }, [items, today, historyStart]);

  const futureTasks = useMemo(() => items.filter((t) => t.plannerDate != null && t.plannerDate > today), [items, today]);

  const backlogTasks = useMemo(() => items.filter((t) => t.plannerDate == null && !t.done), [items]);

  const load = useCallback(async () => {
    if (!userId) return;
    setPlannerSyncing(true);
    try {
    const day = todayStr();

    const { data: rolled, error: rollErr } = await supabase
      .from("planner_tasks")
      .update({ planner_date: null, in_progress: false })
      .eq("user_id", userId)
      .eq("done", false)
      .lt("planner_date", day)
      .select("id");
    if (rollErr) console.error(rollErr);
    else if (rolled?.length) {
      flash(`✓ Moved ${rolled.length} unfinished task(s) to backlog (not on today or a future day).`);
    }

    const { error: delErr } = await supabase
      .from("planner_tasks")
      .delete()
      .eq("user_id", userId)
      .eq("done", false)
      .not("planner_date", "is", null)
      .lt("planner_date", historyStart);
    if (delErr) console.error(delErr);

    const [{ data: ranged, error: rangeErr }, { data: backlogRows, error: backlogErr }] = await Promise.all([
      supabase
        .from("planner_tasks")
        .select("*")
        .eq("user_id", userId)
        .gte("planner_date", historyStart)
        .lte("planner_date", futureEnd)
        .order("planner_date", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("planner_tasks")
        .select("*")
        .eq("user_id", userId)
        .is("planner_date", null)
        .eq("done", false)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (rangeErr || backlogErr) {
      console.error(rangeErr || backlogErr);
      flash("✗ Could not load planner. Run backlog migration (nullable planner_date) in Supabase if this persists.");
      setItems([]);
    } else {
      const byId = new Map();
      for (const row of ranged || []) byId.set(row.id, row);
      for (const row of backlogRows || []) byId.set(row.id, row);
      const normalized = [...byId.values()].map(normalizePlannerTask);
      setItems(normalized);
      // Batch-load subtasks for the tasks now in view.
      const ids = normalized.map((t) => t.id);
      if (ids.length) {
        const { byPlanner } = await listSubtasks({ plannerIds: ids });
        setSubtasksByTask(Object.fromEntries(byPlanner));
      } else {
        setSubtasksByTask({});
      }
    }

    const { data: pts } = await supabase.from("planner_points").select("total_points").eq("user_id", userId).maybeSingle();
    setTotalPoints(pts?.total_points ?? 0);
    } finally {
      setPlannerSyncing(false);
    }
  }, [userId, historyStart, futureEnd, flash]);

  useEffect(() => {
    load();
  }, [load]);

  function nextSortOrder(forDate) {
    const same = items.filter((t) => (forDate == null ? t.plannerDate == null : t.plannerDate === forDate));
    if (same.length === 0) return 0;
    return Math.max(...same.map((t) => t.sortOrder)) + 1;
  }

  async function addPoints(delta) {
    if (!userId || delta === 0) return;
    const { data: row } = await supabase.from("planner_points").select("total_points").eq("user_id", userId).maybeSingle();
    const next = Math.max(0, (row?.total_points ?? 0) + delta);
    const { error } = await supabase.from("planner_points").upsert(
      { user_id: userId, total_points: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (!error) setTotalPoints(next);
  }

  /**
   * Keeps `points_awarded_for_task` and planner total in sync with done / progress / priority.
   * Partial credit = floor(max × progress%); full check = max.
   */
  async function syncTaskGamification(task, partial) {
    if (!userId) return;
    const progressOnly =
      partial.progress !== undefined && partial.done === undefined && partial.priority === undefined;
    if (!progressOnly && saving) return;
    let done = partial.done !== undefined ? partial.done : task.done;
    let priority = partial.priority !== undefined ? Math.min(3, Math.max(0, partial.priority | 0)) : task.priority;
    let progress = task.progress;

    if (partial.done === true) {
      done = true;
      progress = 100;
    } else if (partial.done === false) {
      done = false;
      progress = partial.progress !== undefined ? clampProgress(partial.progress) : 99;
    } else if (partial.progress !== undefined) {
      progress = clampProgress(partial.progress);
      if (!done) progress = Math.min(99, progress);
    }

    if (done) progress = 100;
    else progress = Math.min(99, progress);

    const newTarget = targetCreditedForTask(done, progress, priority);
    const delta = newTarget - task.pointsAwardedForTask;

    const patch = {
      done,
      progress,
      priority,
      points_awarded_for_task: newTarget,
    };
    if (done) patch.in_progress = false;

    if (!progressOnly) setSaving(true);
    try {
      if (delta !== 0) await addPoints(delta);
      const { error } = await supabase.from("planner_tasks").update(patch).eq("id", task.id).eq("user_id", userId);
      if (error) {
        if (delta !== 0) await addPoints(-delta);
        flash("✗ Could not update task");
        return;
      }
      setItems((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                done,
                progress,
                priority,
                pointsAwardedForTask: newTarget,
                inProgress: done ? false : t.inProgress,
              }
            : t,
        ),
      );
    } finally {
      if (!progressOnly) setSaving(false);
    }
  }

  async function addTask(forDate, titleRaw, setInput, priority = 0, projectId = null) {
    const title = titleRaw.trim();
    if (!title || !userId || saving) return;
    setSaving(true);
    const sort_order = nextSortOrder(forDate);
    const row = {
      user_id: userId,
      planner_date: forDate,
      title,
      done: false,
      in_progress: false,
      sort_order,
      priority,
      progress: 0,
      points_awarded_for_task: 0,
    };
    if (projectId) row.project_id = projectId;
    const { data, error } = await supabase.from("planner_tasks").insert(row).select().single();
    setSaving(false);
    if (error) {
      flash("✗ Could not add task");
      return;
    }
    setInput("");
    setItems((prev) => [...prev, normalizePlannerTask(data)]);
  }

  async function addTasksBulk(forDate, titles, priority = 0, projectId = null) {
    if (!userId || saving || !titles.length) return;
    setSaving(true);
    let order = nextSortOrder(forDate);
    const rows = titles.map((title, i) => {
      const r = {
        user_id: userId,
        planner_date: forDate,
        title: title.trim(),
        done: false,
        in_progress: false,
        sort_order: order + i,
        priority,
        progress: 0,
        points_awarded_for_task: 0,
      };
      if (projectId) r.project_id = projectId;
      return r;
    });
    const { data, error } = await supabase.from("planner_tasks").insert(rows).select();
    setSaving(false);
    if (error) {
      flash("✗ Could not add tasks");
      return;
    }
    setItems((prev) => [...prev, ...(data || []).map(normalizePlannerTask)]);
  }

  async function toggleDone(task) {
    if (!userId || saving) return;
    await syncTaskGamification(task, { done: !task.done });
  }

  async function setProgress(task, value) {
    if (!userId || task.done) return;
    await syncTaskGamification(task, { progress: value });
  }

  async function saveTaskNotes(task, raw) {
    if (!userId) return;
    const notes = (typeof raw === "string" ? raw : "").trim();
    if (notes === task.notes) return;
    const { error } = await supabase.from("planner_tasks").update({ notes }).eq("id", task.id).eq("user_id", userId);
    if (error) {
      flash("✗ Could not save notes");
      return;
    }
    setItems((prev) => prev.map((t) => (t.id === task.id ? { ...t, notes } : t)));
  }

  async function setPriority(task, priority) {
    if (!userId || saving || task.done) return;
    await syncTaskGamification(task, { priority });
  }

  async function setTaskProject(task, projectId) {
    if (!userId) return;
    const next = projectId || null;
    if (next === task.projectId) return;
    const { error } = await supabase
      .from("planner_tasks")
      .update({ project_id: next })
      .eq("id", task.id)
      .eq("user_id", userId);
    if (error) {
      flash("✗ Could not update project");
      return;
    }
    setItems((prev) => prev.map((t) => (t.id === task.id ? { ...t, projectId: next } : t)));
  }

  // --- Subtasks -----------------------------------------------------------
  // Derive parent progress from subtask completion and route it through the
  // single gamification path so points stay correct. Full credit still comes
  // from checking the parent done (progress-only updates cap at 99).
  async function recomputeParentProgress(task, subs) {
    const { total, pct } = subtaskProgress(subs);
    if (!total || task.done) return;
    await syncTaskGamification(task, { progress: pct });
  }

  function setSubtasksFor(taskId, next) {
    setSubtasksByTask((prev) => ({ ...prev, [taskId]: next }));
  }

  async function addSubtaskTo(task, titleRaw) {
    const title = (titleRaw || "").trim();
    if (!title || !userId) return;
    const existing = subtasksByTask[task.id] || [];
    const sortOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await addSubtaskRow({ plannerTaskId: task.id, title, sortOrder });
    if (error || !data) {
      flash("✗ Could not add subtask");
      return;
    }
    const next = [...existing, data];
    setSubtasksFor(task.id, next);
    await recomputeParentProgress(task, next);
  }

  async function addAiSubtasksTo(task, titles) {
    if (!userId || !titles?.length) return;
    const existing = subtasksByTask[task.id] || [];
    const startOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await addSubtaskRows({ plannerTaskId: task.id, titles, startOrder });
    if (error || !data) {
      flash("✗ Could not add subtasks");
      return;
    }
    const next = [...existing, ...data].sort((a, b) => a.sort_order - b.sort_order);
    setSubtasksFor(task.id, next);
    await recomputeParentProgress(task, next);
    flash(`✓ Added ${data.length} subtask${data.length === 1 ? "" : "s"}`);
  }

  async function toggleSubtaskFor(task, sub) {
    if (!userId) return;
    const next = (subtasksByTask[task.id] || []).map((s) => (s.id === sub.id ? { ...s, done: !s.done } : s));
    setSubtasksFor(task.id, next); // optimistic
    const { error } = await setSubtaskDone(sub.id, !sub.done);
    if (error) {
      flash("✗ Could not update subtask");
      setSubtasksFor(task.id, subtasksByTask[task.id] || []);
      return;
    }
    await recomputeParentProgress(task, next);
  }

  async function deleteSubtaskFor(task, sub) {
    if (!userId) return;
    const next = (subtasksByTask[task.id] || []).filter((s) => s.id !== sub.id);
    setSubtasksFor(task.id, next);
    const { error } = await deleteSubtaskRow(sub.id);
    if (error) {
      flash("✗ Could not delete subtask");
      setSubtasksFor(task.id, subtasksByTask[task.id] || []);
      return;
    }
    await recomputeParentProgress(task, next);
  }

  function toggleProjectGroup(key) {
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistCollapsedGroupKeys(next);
      return next;
    });
  }

  async function reorderTask(task, direction) {
    if (!userId || saving) return;
    const pid = task.projectId ?? null;
    const sameDate = (a, b) => (a == null ? b == null : a === b);
    const siblings = items
      .filter((x) => sameDate(x.plannerDate, task.plannerDate) && (x.projectId ?? null) === pid)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const i = siblings.findIndex((x) => x.id === task.id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    const a = siblings[i];
    const b = siblings[j];
    setSaving(true);
    const { error: e1 } = await supabase
      .from("planner_tasks")
      .update({ sort_order: b.sortOrder })
      .eq("id", a.id)
      .eq("user_id", userId);
    const { error: e2 } = await supabase
      .from("planner_tasks")
      .update({ sort_order: a.sortOrder })
      .eq("id", b.id)
      .eq("user_id", userId);
    setSaving(false);
    if (e1 || e2) {
      flash("✗ Could not reorder");
      return;
    }
    setItems((prev) =>
      prev.map((t) => {
        if (t.id === a.id) return { ...t, sortOrder: b.sortOrder };
        if (t.id === b.id) return { ...t, sortOrder: a.sortOrder };
        return t;
      }),
    );
  }

  async function setFocus(task) {
    if (!userId || saving || task.done) return;
    setSaving(true);
    const sameDay = items.filter((t) =>
      task.plannerDate == null ? t.plannerDate == null : t.plannerDate === task.plannerDate,
    );
    const updates = sameDay.map((t) =>
      supabase
        .from("planner_tasks")
        .update({ in_progress: t.id === task.id })
        .eq("id", t.id)
        .eq("user_id", userId),
    );
    const results = await Promise.all(updates);
    setSaving(false);
    if (results.some((r) => r.error)) {
      flash("✗ Could not set focus");
      return;
    }
    setItems((prev) =>
      prev.map((t) =>
        (task.plannerDate == null ? t.plannerDate == null : t.plannerDate === task.plannerDate)
          ? { ...t, inProgress: t.id === task.id && !t.done }
          : t,
      ),
    );
  }

  async function deleteTask(id) {
    if (!userId || saving) return;
    setSaving(true);
    const { error } = await supabase.from("planner_tasks").delete().eq("id", id).eq("user_id", userId);
    setSaving(false);
    if (error) {
      flash("✗ Could not delete");
      return;
    }
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  async function moveTaskToDate(task, targetDate) {
    if (!userId || saving) return;
    setSaving(true);
    const dest = items.filter((t) => (targetDate == null ? t.plannerDate == null : t.plannerDate === targetDate));
    const sort_order = dest.length ? Math.max(...dest.map((t) => t.sortOrder)) + 1 : 0;
    const { error } = await supabase
      .from("planner_tasks")
      .update({
        planner_date: targetDate,
        sort_order,
        in_progress: false,
      })
      .eq("id", task.id)
      .eq("user_id", userId);
    setSaving(false);
    if (error) {
      flash("✗ Could not move task");
      return;
    }
    setItems((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, plannerDate: targetDate, sortOrder: sort_order, inProgress: false } : t,
      ),
    );
    flash("✓ Moved");
  }

  async function carryTodayToFuture() {
    const undone = todayTasks.filter((t) => !t.done);
    if (!undone.length || !userId || saving) return;
    setSaving(true);
    const targetDate = tomorrow;
    const dest = items.filter((t) => t.plannerDate === targetDate);
    let order = dest.length ? Math.max(...dest.map((t) => t.sortOrder)) + 1 : 0;
    const ops = undone.map((t) => {
      const thisOrder = order;
      order += 1;
      return supabase
        .from("planner_tasks")
        .update({ planner_date: targetDate, sort_order: thisOrder, in_progress: false })
        .eq("id", t.id)
        .eq("user_id", userId);
    });
    const results = await Promise.all(ops);
    setSaving(false);
    if (results.some((r) => r.error)) {
      flash("✗ Could not move tasks");
      return;
    }
    await load();
    flash(`✓ Moved ${undone.length} to future (${formatDateLabel(targetDate)})`);
  }

  async function sendTodayIncompleteToBacklog() {
    const undone = todayTasks.filter((t) => !t.done);
    if (!undone.length || !userId || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("planner_tasks")
      .update({ planner_date: null, in_progress: false })
      .eq("user_id", userId)
      .eq("done", false)
      .eq("planner_date", today);
    setSaving(false);
    if (error) {
      flash("✗ Could not move to backlog");
      return;
    }
    await load();
    flash(`✓ Moved ${undone.length} task(s) to backlog`);
  }

  async function fetchBreakdownSuggestions() {
    const raw = breakdownBrief.trim();
    if (!raw || saving) return;
    setBreakingDown(true);
    try {
      let steps = await breakdownPlannerTask(raw);
      if (!steps?.length) steps = heuristicBreakdown(raw);
      if (!steps?.length) {
        flash(
          "✗ No suggestions. Add a DeepSeek key in Settings for AI, or write several parts separated by ; or new lines.",
        );
        return;
      }
      setBreakdownSteps(steps);
      setBreakdownSelected(steps.map(() => true));
    } finally {
      setBreakingDown(false);
    }
  }

  function dismissBreakdownSuggestions() {
    setBreakdownSteps(null);
    setBreakdownSelected([]);
  }

  async function addSelectedBreakdownTasks() {
    if (!breakdownSteps?.length || !userId || saving) return;
    const titles = breakdownSteps.filter((_, i) => breakdownSelected[i]);
    if (!titles.length) {
      flash("Select at least one step to add, or dismiss suggestions.");
      return;
    }
    await addTasksBulk(today, titles, 0, defaultProjectId);
    setBreakdownBrief("");
    dismissBreakdownSuggestions();
    flash(`✓ Added ${titles.length} step${titles.length === 1 ? "" : "s"} to today`);
  }

  const breakdownSelectedCount = useMemo(
    () => breakdownSelected.filter(Boolean).length,
    [breakdownSelected],
  );

  const previousByDate = useMemo(() => {
    const m = new Map();
    for (const t of previousTasks) {
      if (!m.has(t.plannerDate)) m.set(t.plannerDate, []);
      m.get(t.plannerDate).push(t);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [previousTasks]);

  const doneToday = todayTasks.filter((t) => t.done).length;
  const doneFuture = futureTasks.filter((t) => t.done).length;

  const inputCls = dark
    ? "bg-[var(--color-surface)] border-slate-600 text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-200 text-slate-900";

  // Shared renderer for a project-grouped task list (Today / Earlier /
  // Backlog / Future). Plain function (not a component) so React keeps
  // reconciling the same CollapsibleProjectGroup / PlannerTaskRow trees.
  function renderTaskGroups(tasks, keyPrefix, { showDateBadge = false, dateBadgeStr, dateBadgeFor } = {}) {
    return (
      <div className="space-y-3">
        {groupPlannerTasksByProject(tasks, projects).map((group) => {
          const gk = `${keyPrefix}:${group.key}`;
          return (
            <CollapsibleProjectGroup
              key={group.key}
              groupId={gk}
              heading={group.heading}
              color={group.color}
              taskCount={group.tasks.length}
              dark={dark}
              collapsed={collapsedGroupKeys.has(gk)}
              onToggle={toggleProjectGroup}
            >
              <ul className="space-y-2.5 sm:space-y-3">
                {group.tasks.map((t, idx) => (
                  <PlannerTaskRow
                    key={t.id}
                    t={t}
                    dark={dark}
                    disabled={saving}
                    showDateBadge={showDateBadge}
                    dateBadgeStr={dateBadgeFor ? dateBadgeFor(t) : dateBadgeStr}
                    projects={projects}
                    maxPoints={pointsForComplete(t.priority)}
                    onToggleDone={toggleDone}
                    onDelete={deleteTask}
                    onSetFocus={setFocus}
                    moveDestinations={getMoveDestinations(t, today, tomorrow)}
                    onMoveToDate={moveTaskToDate}
                    onPriorityChange={setPriority}
                    onProgressChange={setProgress}
                    onNotesChange={saveTaskNotes}
                    onProjectChange={setTaskProject}
                    subtasks={subtasksByTask[t.id]}
                    onAddSubtask={addSubtaskTo}
                    onAddAiSubtasks={addAiSubtasksTo}
                    onToggleSubtask={toggleSubtaskFor}
                    onDeleteSubtask={deleteSubtaskFor}
                    reorder={{
                      canUp: idx > 0,
                      canDown: idx < group.tasks.length - 1,
                      onReorder: (dir) => reorderTask(t, dir),
                    }}
                  />
                ))}
              </ul>
            </CollapsibleProjectGroup>
          );
        })}
      </div>
    );
  }

  // First-load skeleton. Once items have ever populated, subsequent
  // background re-syncs use the inline "Updating planner…" pill below
  // instead of wiping the whole UI.
  if (plannerSyncing && items.length === 0) {
    return (
      <div
        className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-14 pb-28"
        aria-busy="true"
        aria-label="Loading planner"
      >
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-4/5 mb-8" />
        {[0, 1, 2].map((s) => (
          <SkeletonCard key={s} className="mb-4 p-5 space-y-3">
            <Skeleton className="h-4 w-24" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </SkeletonCard>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-14 pb-28">
      {plannerSyncing && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
          }`}
        >
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-current opacity-80" aria-hidden />
          Updating planner from the server…
        </div>
      )}
      <div className="mb-10 sm:mb-12 flex flex-col gap-8">
        <div>
          <h2 className={`text-2xl sm:text-3xl font-bold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>Daily planner</h2>
          <p className={`mt-4 text-sm sm:text-[15px] leading-relaxed max-w-2xl ${dark ? "text-slate-400" : "text-slate-600"}`}>
            Current work and what is coming up. Tasks can be tagged with a <strong className="font-semibold">project</strong>{" "}
            and are grouped that way in each list. Open tasks from recent days stay visible under{" "}
            <strong className="font-semibold">Earlier</strong> until you finish them or they age out (
            {PLANNER_HISTORY_DAYS} days). Use the <strong className="font-semibold">progress</strong> slider for partial
            credit (up to 99%), add <strong className="font-semibold">notes</strong> for what is left to do, then check the
            task to earn the rest — higher priority raises the point cap.{" "}
            <strong className="font-semibold">Break into steps</strong> uses a separate description field; pick which
            suggestions to add. A DeepSeek key in Settings enables AI (otherwise use several phrases separated by{" "}
            <code className={`text-[13px] rounded px-1 py-0.5 ${dark ? "bg-[var(--color-surface-raised)] text-slate-200" : "bg-slate-100 text-slate-800"}`}>
              ;
            </code>
            .
          </p>
        </div>
        <div
          className={`flex items-center gap-4 rounded-2xl border px-6 py-5 sm:px-8 sm:py-6 w-full sm:w-auto sm:max-w-sm ${
            dark ? "border-amber-500/25 bg-amber-500/5" : "border-amber-200 bg-amber-50/80"
          }`}
        >
          <Trophy className={`w-9 h-9 sm:w-10 sm:h-10 shrink-0 ${dark ? "text-amber-400" : "text-amber-600"}`} aria-hidden />
          <div>
            <p className={`text-xs font-medium uppercase tracking-wide ${dark ? "text-amber-200/80" : "text-amber-800"}`}>
              Planner points
            </p>
            <p className={`text-3xl font-bold tabular-nums ${dark ? "text-amber-100" : "text-amber-900"}`}>{totalPoints}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-10 sm:gap-12">
        <Card
          className={
            dark
              ? "border-[var(--color-accent)] bg-[var(--color-bg)] shadow-lg rounded-2xl"
              : "border-slate-200/80 bg-white/80 shadow-sm rounded-2xl"
          }
        >
          <CardHeader className="space-y-2 p-8 sm:p-10 pb-4 sm:pb-5">
            <CardTitle className={`text-xl sm:text-2xl ${dark ? "text-white" : "text-slate-800"}`}>Current</CardTitle>
            <CardDescription className={`text-[15px] leading-relaxed ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Today and anything still open from the last few days
            </CardDescription>
            <p className="text-xs font-medium pt-2 text-[var(--color-accent)]">
              Today: {doneToday} of {todayTasks.length} done
              {previousTasks.length > 0 && ` · ${previousTasks.length} earlier`}
            </p>
          </CardHeader>
          <CardContent className="space-y-8 px-8 sm:px-10 pb-8 sm:pb-10 pt-0">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${dark ? "text-slate-500" : "text-slate-500"}`}>
                Today · {formatDateLabel(today)}
              </p>
              {todayTasks.length === 0 && (
                <p className={`text-sm mb-3 ${dark ? "text-slate-500" : "text-slate-500"}`}>No tasks for today yet.</p>
              )}
              {renderTaskGroups(todayTasks, "today")}
            </div>

            {previousByDate.length > 0 && (
              <div className="pt-6 border-t border-dashed border-slate-600/30">
                <p className={`text-xs font-semibold uppercase tracking-wide mb-4 ${dark ? "text-slate-500" : "text-slate-500"}`}>
                  Earlier (rolling {PLANNER_HISTORY_DAYS} days)
                </p>
                {previousByDate.map(([dateStr, dayTasks]) => (
                  <div key={dateStr} className="mb-6 last:mb-0">
                    <p className={`text-[11px] font-medium mb-2.5 ${dark ? "text-slate-500" : "text-slate-500"}`}>
                      {formatDateLabel(dateStr)}
                    </p>
                    {renderTaskGroups(dayTasks, `earlier:${dateStr}`)}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <span className={`text-xs font-medium shrink-0 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                  Default project
                </span>
                <Select
                  value={defaultProjectId ?? "__none__"}
                  onValueChange={(v) => setDefaultProjectId(v === "__none__" ? null : v)}
                  disabled={saving}
                >
                  <SelectTrigger className={`h-9 w-full sm:w-[200px] text-xs ${inputCls}`} aria-label="Default project for new tasks">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Add a task for today…"
                  value={newCurrent}
                  onChange={(e) => setNewCurrent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTask(today, newCurrent, setNewCurrent, 0, defaultProjectId);
                    }
                  }}
                  className={`text-sm min-h-11 ${inputCls}`}
                  disabled={saving}
                />
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 sm:min-w-[88px]"
                  onClick={() => addTask(today, newCurrent, setNewCurrent, 0, defaultProjectId)}
                  disabled={saving}
                >
                  Add
                </Button>
              </div>
            </div>

            <div
              className={`rounded-xl border px-4 py-4 sm:px-5 sm:py-5 space-y-3 ${
                dark ? "border-slate-600/70 bg-[var(--color-bg)]/30" : "border-slate-200 bg-slate-50/90"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>
                    Break a task into steps
                  </p>
                  <p className={`text-xs mt-1 max-w-xl ${dark ? "text-slate-500" : "text-slate-500"}`}>
                    Describe the bigger task or goal here (not the same box as a single quick add). Get suggestions, then
                    choose what to add.
                  </p>
                </div>
                {breakdownSteps && breakdownSteps.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs shrink-0"
                    onClick={dismissBreakdownSuggestions}
                    disabled={saving}
                    aria-label="Dismiss suggestions"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Dismiss
                  </Button>
                )}
              </div>
              <Textarea
                id="planner-breakdown-brief"
                rows={3}
                placeholder="e.g. Prepare the quarterly review deck: gather metrics, draft slides, and rehearse…"
                value={breakdownBrief}
                onChange={(e) => setBreakdownBrief(e.target.value)}
                disabled={saving || breakingDown}
                className={`text-sm min-h-[80px] resize-y ${inputCls}`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5 py-5 sm:py-2"
                onClick={fetchBreakdownSuggestions}
                disabled={saving || breakingDown || !breakdownBrief.trim()}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {breakingDown ? "Getting suggestions…" : breakdownSteps?.length ? "Regenerate suggestions" : "Get suggestions"}
              </Button>

              {breakdownSteps && breakdownSteps.length > 0 && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-xs font-medium ${dark ? "text-slate-300" : "text-slate-700"}`}>
                      Suggested tasks ({breakdownSelectedCount} selected)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setBreakdownSelected(breakdownSteps.map(() => true))}
                        disabled={saving}
                      >
                        All
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setBreakdownSelected(breakdownSteps.map(() => false))}
                        disabled={saving}
                      >
                        None
                      </Button>
                    </div>
                  </div>
                  <ul
                    className={`rounded-lg border divide-y max-h-[min(280px,50vh)] overflow-y-auto ${
                      dark ? "border-slate-600/80 divide-slate-700/80" : "border-slate-200 divide-slate-200"
                    }`}
                  >
                    {breakdownSteps.map((line, i) => (
                      <li
                        key={`${i}-${line.slice(0, 24)}`}
                        className={`flex items-start gap-3 px-3 py-2.5 ${
                          dark ? "bg-slate-900/20" : "bg-white/80"
                        }`}
                      >
                        <Checkbox
                          checked={breakdownSelected[i] === true}
                          onCheckedChange={(v) =>
                            setBreakdownSelected((prev) => {
                              const next = [...prev];
                              next[i] = v === true;
                              return next;
                            })
                          }
                          disabled={saving}
                          className="mt-0.5"
                          aria-label={`Include: ${line}`}
                        />
                        <span className={`text-sm leading-snug flex-1 min-w-0 ${dark ? "text-slate-200" : "text-slate-800"}`}>
                          {line}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full text-xs py-5 sm:py-2"
                    onClick={addSelectedBreakdownTasks}
                    disabled={saving || breakdownSelectedCount === 0}
                  >
                    Add selected to today
                  </Button>
                </div>
              )}
            </div>

            {todayTasks.some((t) => !t.done) && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs py-5 sm:py-2"
                  onClick={carryTodayToFuture}
                  disabled={saving}
                >
                  Move all unchecked from today to tomorrow
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs py-5 sm:py-2"
                  onClick={sendTodayIncompleteToBacklog}
                  disabled={saving}
                >
                  Move all unchecked from today to backlog
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className={
            dark
              ? "border-violet-500/15 bg-[var(--color-bg)] shadow-[0_0_30px_rgba(139,92,246,0.06)] rounded-2xl"
              : "border-violet-200/80 bg-white/80 shadow-sm rounded-2xl"
          }
        >
          <CardHeader className="space-y-2 p-8 sm:p-10 pb-4 sm:pb-5">
            <CardTitle className={`text-xl sm:text-2xl ${dark ? "text-white" : "text-slate-800"}`}>Backlog</CardTitle>
            <CardDescription className={`text-[15px] leading-relaxed ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Unscheduled ideas and anything that rolled back when its day passed without being moved to a future date.
              Each time you open the planner, unfinished tasks dated before today are moved here automatically.
            </CardDescription>
            <p className={`text-xs font-medium pt-2 ${dark ? "text-violet-300/90" : "text-violet-800"}`}>
              {backlogTasks.length} open
            </p>
          </CardHeader>
          <CardContent className="space-y-6 px-8 sm:px-10 pb-8 sm:pb-10 pt-0">
            {backlogTasks.length === 0 && (
              <p className={`text-sm leading-relaxed ${dark ? "text-slate-500" : "text-slate-500"}`}>
                Nothing in backlog. Add an idea below, or leave today&apos;s tasks for the next day — anything not on tomorrow
                rolls here after the day ends.
              </p>
            )}
            {renderTaskGroups(backlogTasks, "backlog", { showDateBadge: true, dateBadgeStr: "Backlog" })}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Input
                placeholder="Capture an idea for later…"
                value={newBacklog}
                onChange={(e) => setNewBacklog(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTask(null, newBacklog, setNewBacklog, 0, defaultProjectId);
                  }
                }}
                className={`text-sm min-h-11 ${inputCls}`}
                disabled={saving}
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0 sm:min-w-[88px]"
                onClick={() => addTask(null, newBacklog, setNewBacklog, 0, defaultProjectId)}
                disabled={saving}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card
          className={
            dark
              ? "border-[var(--color-accent)] bg-[var(--color-bg)] shadow-lg rounded-2xl"
              : "border-slate-200/80 bg-white/80 shadow-sm rounded-2xl"
          }
        >
          <CardHeader className="space-y-2 p-8 sm:p-10 pb-4 sm:pb-5">
            <CardTitle className={`text-xl sm:text-2xl ${dark ? "text-white" : "text-slate-800"}`}>Future plans</CardTitle>
            <CardDescription className={`text-[15px] leading-relaxed ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Anything scheduled after today (next {PLANNER_FUTURE_DAYS} days)
            </CardDescription>
            <p className="text-xs font-medium pt-2 text-[var(--color-accent)]">
              {doneFuture} of {futureTasks.length} done
            </p>
          </CardHeader>
          <CardContent className="space-y-6 px-8 sm:px-10 pb-8 sm:pb-10 pt-0">
            {futureTasks.length === 0 && (
              <p className={`text-sm leading-relaxed ${dark ? "text-slate-500" : "text-slate-500"}`}>
                Nothing scheduled ahead. Add something for tomorrow or beyond.
              </p>
            )}
            {renderTaskGroups(futureTasks, "future", {
              showDateBadge: true,
              dateBadgeFor: (t) =>
                new Date(t.plannerDate + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }),
            })}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Input
                placeholder={`Add for ${formatDateLabel(tomorrow)}…`}
                value={newFuture}
                onChange={(e) => setNewFuture(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTask(tomorrow, newFuture, setNewFuture, 0, defaultProjectId);
                  }
                }}
                className={`text-sm min-h-11 ${inputCls}`}
                disabled={saving}
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0 sm:min-w-[88px]"
                onClick={() => addTask(tomorrow, newFuture, setNewFuture, 0, defaultProjectId)}
                disabled={saving}
              >
                Add
              </Button>
            </div>
            <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>
              New tasks use the <strong className="font-medium text-inherit">Default project</strong> from Current above.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className={`mt-10 sm:mt-12 text-xs leading-relaxed max-w-2xl ${dark ? "text-slate-500" : "text-slate-500"}`}>
        Unchecked tasks older than {PLANNER_HISTORY_DAYS} days (with a calendar date) are removed automatically.
        Unfinished tasks dated before today are moved to <strong className="font-semibold">Backlog</strong> when you load
        the planner (end-of-day rollover — anything not scheduled on today or a future day returns to the backlog). Use
        &quot;Move all unchecked from today to tomorrow&quot; or &quot;…to backlog&quot; to clear today manually. Partial
        progress adjusts your score; priority raises the cap. Project group order and collapsed sections are remembered on
        this device.
      </p>
    </div>
  );
}
