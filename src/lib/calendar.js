import { supabase } from "../supabase";

// Data layer + FullCalendar mappers for the unified calendar (/calendar).
//
// Each "layer" has a fetcher (range-scoped DB read) and a pure mapper
// (row -> FullCalendar event input). The page loads enabled layers for the
// visible range on `datesSet` and concatenates the mapped events.

export const LAYERS = ["meetings", "tasks", "goals", "availability"];
export const LAYER_LABEL = {
  meetings: "Meetings",
  tasks: "Planner tasks",
  goals: "Goals",
  availability: "Work hours & OOO",
};

const COLOR = {
  meeting: "#14b8a6",
  task: "#6366f1",
  goal: "#f59e0b",
  ooo: "rgba(100,116,139,0.18)",
};

// ── date helpers (local, no external date lib) ─────────────────────────
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// ── fetchers ───────────────────────────────────────────────────────────
export async function fetchMeetingsInRange(teamId, startISO, endISO) {
  if (!teamId) return { data: [] };
  return supabase
    .from("scheduled_meetings")
    .select("id, room_id, title, description, starts_at, ends_at, created_by")
    .eq("team_id", teamId)
    .gte("starts_at", startISO)
    .lte("starts_at", endISO)
    .order("starts_at");
}

export async function fetchPlannerTasksInRange(userId, startDate, endDate) {
  if (!userId) return { data: [] };
  return supabase
    .from("planner_tasks")
    .select("id, planner_date, title, done, in_progress, priority")
    .eq("user_id", userId)
    .not("planner_date", "is", null)
    .gte("planner_date", startDate)
    .lte("planner_date", endDate)
    .order("planner_date");
}

// Own work-hours / OOO. Authoritative column names from user_settings.
export async function fetchMyAvailability(userId) {
  if (!userId) return { data: null };
  return supabase
    .from("user_settings")
    .select("work_start, work_end, work_days, ooo_start, ooo_end, ooo_note, ooo_ranges")
    .eq("user_id", userId)
    .maybeSingle();
}

// ── mappers (row -> FullCalendar event) ────────────────────────────────
export function meetingToEvent(m) {
  return {
    id: `meeting:${m.id}`,
    title: m.title || "Meeting",
    start: m.starts_at,
    end: m.ends_at,
    backgroundColor: COLOR.meeting,
    borderColor: COLOR.meeting,
    editable: false, // Phase 1 read-only
    extendedProps: { type: "meeting", sourceId: m.id, roomId: m.room_id },
  };
}

export function plannerTaskToEvent(t) {
  return {
    id: `task:${t.id}`,
    title: t.title,
    start: t.planner_date,
    allDay: true,
    backgroundColor: COLOR.task,
    borderColor: COLOR.task,
    editable: false,
    classNames: t.done ? ["cal-task-done"] : [],
    extendedProps: { type: "task", sourceId: t.id, done: t.done },
  };
}

// Week-scoped goal → an all-day banner spanning its week (Mon..Sun).
export function goalToEvent(g) {
  if (!g.week_start) return null;
  return {
    id: `goal:${g.id}`,
    title: `🎯 ${g.body || "Goal"}`,
    start: g.week_start,
    end: addDaysStr(g.week_start, 7), // exclusive end
    allDay: true,
    display: "block",
    backgroundColor: "transparent",
    borderColor: COLOR.goal,
    textColor: COLOR.goal,
    editable: false,
    extendedProps: { type: "goal", sourceId: g.id },
  };
}

// OOO ranges → background events (single ooo_start..ooo_end plus any ooo_ranges).
export function availabilityToEvents(settings) {
  if (!settings) return [];
  const out = [];
  const push = (start, end, note, key) => {
    if (!start) return;
    out.push({
      id: `ooo:${key}`,
      start,
      end: addDaysStr(end || start, 1), // inclusive end → FC exclusive
      allDay: true,
      display: "background",
      backgroundColor: COLOR.ooo,
      extendedProps: { type: "ooo", note: note || "Out of office" },
    });
  };
  if (settings.ooo_start) push(settings.ooo_start, settings.ooo_end, settings.ooo_note, "primary");
  (Array.isArray(settings.ooo_ranges) ? settings.ooo_ranges : []).forEach((r, i) =>
    push(r.start, r.end, r.note, `r${i}`),
  );
  return out;
}

// FullCalendar businessHours from work_start/work_end/work_days.
const DAY_NUM = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
export function businessHoursFromSettings(settings) {
  if (!settings?.work_start || !settings?.work_end) return false;
  const days = Array.isArray(settings.work_days) && settings.work_days.length
    ? settings.work_days
        .map((d) => (typeof d === "number" ? d : DAY_NUM[String(d).toLowerCase()]))
        .filter((d) => d !== undefined)
    : [1, 2, 3, 4, 5];
  return {
    daysOfWeek: days,
    startTime: String(settings.work_start).slice(0, 5),
    endTime: String(settings.work_end).slice(0, 5),
  };
}
