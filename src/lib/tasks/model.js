// Unified task model — the single normalized shape every task surface renders
// and edits, plus the shared visual vocabulary (labels, priorities, deadlines).
//
// Two DB systems feed this: planner_tasks (rich, dated, gamified) and
// personal_tasks (lightweight team checklist). Both share task_subtasks. The
// normalized shape hides those differences behind a `kind` discriminator so the
// timeline + the shared slide-over editor treat them uniformly.
//
// Colors reference the `--o-*` ocean tokens (see tasks-ocean.css); everything
// that renders these lives inside a `.tl-ocean` scope.

/** Task labels — a small, colored, client-defined set (no join table). */
export const TASK_LABELS = {
  design:   { name: "Design",   bg: "rgba(45,127,249,.14)", fg: "var(--o-ocean-700)" },
  research: { name: "Research", bg: "rgba(20,196,174,.18)", fg: "var(--o-aqua-700)" },
  writing:  { name: "Writing",  bg: "rgba(255,159,28,.18)", fg: "var(--o-mango-700)" },
  bug:      { name: "Bug",      bg: "rgba(251,94,75,.14)",  fg: "var(--o-coral-700)" },
  admin:    { name: "Admin",    bg: "var(--o-sand-200)",    fg: "var(--o-ink-600)" },
};
export const LABEL_KEYS = Object.keys(TASK_LABELS);

// Custom (user-typed) labels aren't in TASK_LABELS — give each a stable color
// picked deterministically from the ocean palette so the same name always looks
// the same. The stored value IS the display name.
const CUSTOM_LABEL_COLORS = [
  { bg: "rgba(45,127,249,.14)", fg: "var(--o-ocean-700)" },
  { bg: "rgba(20,196,174,.18)", fg: "var(--o-aqua-700)" },
  { bg: "rgba(255,159,28,.18)", fg: "var(--o-mango-700)" },
  { bg: "rgba(251,94,75,.14)", fg: "var(--o-coral-700)" },
  { bg: "rgba(251,192,45,.20)", fg: "var(--o-mango-700)" },
  { bg: "var(--o-sand-200)", fg: "var(--o-ink-600)" },
];
function hashLabel(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function labelMeta(key) {
  if (TASK_LABELS[key]) return TASK_LABELS[key];
  return { name: key, ...CUSTOM_LABEL_COLORS[hashLabel(key) % CUSTOM_LABEL_COLORS.length] };
}

/** Status tracker states (To do → In progress → Done). 'done' mirrors the
 *  task's `done` flag; 'doing' is distinct from the pomodoro focus flag. */
export const TASK_STATUSES = [
  { value: "todo",  label: "To do",       color: "var(--o-ink-400)",   bg: "var(--o-sand-100)",       fg: "var(--o-ink-600)",   border: "var(--o-border-strong)" },
  { value: "doing", label: "In progress", color: "var(--o-ocean-500)", bg: "rgba(45,127,249,.12)",    fg: "var(--o-ocean-700)", border: "var(--o-ocean-500)" },
  { value: "done",  label: "Done",        color: "var(--o-aqua-500)",  bg: "rgba(20,196,174,.16)",    fg: "var(--o-aqua-700)",  border: "var(--o-aqua-500)" },
];
export function statusMeta(value) {
  return TASK_STATUSES.find((s) => s.value === value) || TASK_STATUSES[0];
}

/** Priority 0-3 → color/pill styling. 0 = no priority (no dot). */
export const PRIORITY = {
  0: { value: 0, label: "None",   color: "var(--o-ink-300)"  },
  1: { value: 1, label: "Low",    color: "var(--o-ocean-500)", bg: "rgba(45,127,249,.14)", fg: "var(--o-ocean-700)", border: "var(--o-ocean-500)" },
  2: { value: 2, label: "Medium", color: "var(--o-mango-500)", bg: "rgba(255,159,28,.18)", fg: "var(--o-mango-700)", border: "var(--o-mango-500)" },
  3: { value: 3, label: "High",   color: "var(--o-coral-500)", bg: "rgba(251,94,75,.14)",  fg: "var(--o-coral-700)", border: "var(--o-coral-500)" },
};
/** Pickable priorities in the editor, high → low (matches the design). */
export const PRIORITY_CHOICES = [PRIORITY[3], PRIORITY[2], PRIORITY[1]];

export function priorityMeta(p) {
  return PRIORITY[Math.min(3, Math.max(0, Number(p) || 0))];
}

/**
 * Normalize a raw DB row (planner_tasks | personal_tasks) into the unified shape.
 * Fields absent on personal_tasks fall back to sensible defaults so callers never
 * branch on kind for reads.
 */
export function normalizeTask(row, kind = "planner") {
  return {
    id: row.id,
    kind,
    title: (row.title || "").trim(),
    done: row.done === true,
    // `done` is authoritative — never show a status that disagrees with it.
    status: row.done === true ? "done" : (row.status === "doing" ? "doing" : "todo"),
    archived: row.archived === true,
    priority: Math.min(3, Math.max(0, Number(row.priority) || 0)),
    progress: Math.min(100, Math.max(0, Number(row.progress) || 0)),
    dueDate: row.due_date ?? null,
    plannerDate: row.planner_date ?? null,
    deadline: row.deadline === "hard" ? "hard" : "soft",
    labels: Array.isArray(row.labels) ? row.labels : [],
    notes: typeof row.notes === "string" ? row.notes : "",
    projectId: row.project_id ?? null,
    inProgress: row.in_progress === true,
    focusSessions: Math.max(0, Number(row.focus_sessions) || 0),
    pointsAwardedForTask: Math.max(0, Number(row.points_awarded_for_task) || 0),
    teamId: row.team_id ?? null,
  };
}

// Which editor fields a task kind supports (personal is intentionally lean —
// no notes/priority/progress/project/focus columns).
export function supportsField(kind, field) {
  if (kind === "personal") {
    return ["title", "done", "dueDate", "deadline", "labels", "subtasks"].includes(field);
  }
  return true; // planner supports everything
}
