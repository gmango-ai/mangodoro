// Event-type → styling for the reskinned calendar.
// bg = chip tint, fg = chip text, solid = the type's saturated color (dot/border).
//
// Colors are DERIVED FROM THE USER'S ACCENT: every value is a CSS custom
// property (--cal-cat-*) defined on `.cal-ocean` in calendar-ocean.css via
// color-theory hue offsets, tuned for vibrance + contrast and given a brighter
// dark-mode variant. These strings are used as inline `style` values (background
// / color / borderColor) which resolve the var() against the .cal-ocean
// container, so the whole calendar tracks the accent and adapts to light/dark.

// A chip from one category var: a translucent tint background, the solid color
// as text + dot/border. color-mix keeps the tint consistent across light/dark.
const chip = (v) => ({ bg: `color-mix(in srgb, ${v} 20%, transparent)`, fg: v, solid: v });

const T = {
  meeting:   { label: "Meeting",       ...chip("var(--cal-cat-meeting, #14b8a6)") },
  task:      { label: "Task",          ...chip("var(--cal-cat-task, #6366f1)") },
  task_due:  { label: "Deadline",      ...chip("var(--cal-cat-due, #ef4444)") },
  ptask_due: { label: "Deadline",      ...chip("var(--cal-cat-due, #ef4444)") },
  milestone: { label: "Milestone",     ...chip("var(--cal-cat-milestone, #a855f7)") },
  goal:      { label: "Goal",          ...chip("var(--cal-cat-goal, #f59e0b)") },
  ooo:       { label: "Out of office", ...chip("var(--cal-cat-actual, #7F9AA7)") },
  actual:    { label: "Time tracked",  ...chip("var(--cal-cat-actual, #94a3b8)") },
  google:    { label: "Google",        ...chip("var(--cal-cat-google, #4285F4)") },
  worklocation:          { label: "Working location", ...chip("var(--cal-cat-actual, #7F9AA7)") },
  worklocation_app:      { label: "Working location", ...chip("var(--cal-cat-actual, #7DB4F8)") },
  worklocation_conflict: { label: "Location conflict", ...chip("var(--cal-cat-due, #FF9F1C)") },
};
const FALLBACK = { label: "Event", ...chip("var(--cal-cat-actual, #7F9AA7)") };

export function oceanType(type) { return T[type] || FALLBACK; }

// The left-rail "My calendars" filter list (layer id → label + color).
export const OCEAN_LEGEND = [
  { layer: "meetings", label: "Meetings", solid: T.meeting.solid },
  { layer: "tasks", label: "Tasks", solid: T.task.solid },
  { layer: "deadlines", label: "Deadlines", solid: T.task_due.solid },
  { layer: "goals", label: "Goals", solid: T.goal.solid },
  { layer: "availability", label: "Work hours & OOO", solid: T.ooo.solid },
  { layer: "actuals", label: "Time tracked", solid: T.actual.solid },
  { layer: "google", label: "Google Calendar", solid: T.google.solid },
];
