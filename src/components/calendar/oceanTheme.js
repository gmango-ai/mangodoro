// Event-type → ocean-palette styling for the reskinned calendar.
// bg = chip tint, fg = chip text, dot/solid = the type's saturated color.

const T = {
  meeting:   { label: "Meeting",   bg: "rgba(45,127,249,0.14)",  fg: "#1A4FA8", solid: "#2D7FF9" },
  task:      { label: "Task",      bg: "rgba(255,159,28,0.16)",  fg: "#C96A05", solid: "#FF9F1C" },
  task_due:  { label: "Deadline",  bg: "rgba(251,94,75,0.14)",   fg: "#BE2E1D", solid: "#FB5E4B" },
  ptask_due: { label: "Deadline",  bg: "rgba(251,94,75,0.14)",   fg: "#BE2E1D", solid: "#FB5E4B" },
  milestone: { label: "Milestone", bg: "rgba(20,196,174,0.16)",  fg: "#097E71", solid: "#14C4AE" },
  goal:      { label: "Goal",      bg: "rgba(251,192,45,0.18)",  fg: "#9C5208", solid: "#FBC02D" },
  ooo:       { label: "Out of office", bg: "rgba(85,118,134,0.14)", fg: "#355d6e", solid: "#7F9AA7" },
  actual:    { label: "Time tracked", bg: "rgba(169,190,200,0.20)", fg: "#557686", solid: "#A9BEC8" },
  google:    { label: "Google",    bg: "rgba(125,180,248,0.16)", fg: "#1A4FA8", solid: "#7DB4F8" },
  worklocation: { label: "Working location", bg: "rgba(85,118,134,0.10)", fg: "#355d6e", solid: "#7F9AA7" },
};
const FALLBACK = { label: "Event", bg: "rgba(85,118,134,0.14)", fg: "#355d6e", solid: "#7F9AA7" };

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
