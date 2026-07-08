import { supabase } from "../supabase";

// Data layer + FullCalendar mappers for the unified calendar (/calendar).
//
// Each "layer" has a fetcher (range-scoped DB read) and a pure mapper
// (row -> FullCalendar event input). The page loads enabled layers for the
// visible range on `datesSet` and concatenates the mapped events.

export const LAYERS = ["meetings", "tasks", "deadlines", "goals", "availability", "actuals"];
export const LAYER_LABEL = {
  meetings: "Meetings",
  tasks: "Planner tasks",
  deadlines: "Deadlines",
  goals: "Goals",
  availability: "Work hours & OOO",
  actuals: "Time tracked",
};

const COLOR = {
  meeting: "#14b8a6",
  task: "#6366f1",
  due: "#ef4444",
  milestone: "#a855f7",
  goal: "#f59e0b",
  ooo: "rgba(100,116,139,0.18)",
  actual: "#94a3b8",
};

// Lenient 'HH:MM' / 'H:MM am' parser for the free-text entries.start/end_time.
function parseHM(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function timeStrFromDate(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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
    .select("id, planner_date, due_date, start_time, duration_min, title, done, in_progress, priority")
    .eq("user_id", userId)
    .not("planner_date", "is", null)
    .gte("planner_date", startDate)
    .lte("planner_date", endDate)
    .order("planner_date");
}

export async function fetchPlannerDueInRange(userId, startDate, endDate) {
  if (!userId) return { data: [] };
  return supabase
    .from("planner_tasks")
    .select("id, due_date, title, done")
    .eq("user_id", userId)
    .not("due_date", "is", null)
    .gte("due_date", startDate)
    .lte("due_date", endDate);
}

export async function fetchPersonalDueInRange(userId, startDate, endDate) {
  if (!userId) return { data: [] };
  return supabase
    .from("personal_tasks")
    .select("id, due_date, title, done")
    .eq("user_id", userId)
    .not("due_date", "is", null)
    .gte("due_date", startDate)
    .lte("due_date", endDate);
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
    editable: true,
    extendedProps: { type: "meeting", sourceId: m.id, roomId: m.room_id, googleEventId: m.google_event_id },
  };
}

export function plannerTaskToEvent(t) {
  const base = {
    id: `task:${t.id}`,
    title: t.title,
    backgroundColor: COLOR.task,
    borderColor: COLOR.task,
    editable: true,
    classNames: t.done ? ["cal-task-done"] : [],
    extendedProps: { type: "task", sourceId: t.id, done: t.done },
  };
  if (t.start_time && t.duration_min) {
    const start = `${t.planner_date}T${String(t.start_time).slice(0, 5)}`;
    const end = new Date(new Date(start).getTime() + t.duration_min * 60000);
    return { ...base, start, end, allDay: false };
  }
  return { ...base, start: t.planner_date, allDay: true };
}

export function taskDueToEvent(t) {
  return {
    id: `taskdue:${t.id}`,
    title: `⏳ ${t.title}`,
    start: t.due_date,
    allDay: true,
    backgroundColor: "transparent",
    borderColor: COLOR.due,
    textColor: COLOR.due,
    editable: true,
    extendedProps: { type: "task_due", sourceId: t.id },
  };
}

export function personalDueToEvent(t) {
  return {
    id: `pdue:${t.id}`,
    title: `⏳ ${t.title}`,
    start: t.due_date,
    allDay: true,
    backgroundColor: "transparent",
    borderColor: COLOR.due,
    textColor: COLOR.due,
    editable: true,
    extendedProps: { type: "ptask_due", sourceId: t.id },
  };
}

export function milestoneToEvent(m) {
  const base = {
    id: `milestone:${m.id}`,
    title: `◆ ${m.title}`,
    backgroundColor: m.color || COLOR.milestone,
    borderColor: m.color || COLOR.milestone,
    editable: true,
    extendedProps: { type: "milestone", sourceId: m.id, scope: m.scope, row: m },
  };
  if (m.milestone_time) {
    return { ...base, start: `${m.milestone_date}T${String(m.milestone_time).slice(0, 5)}`, allDay: false };
  }
  return { ...base, start: m.milestone_date, allDay: true };
}

export function entryToEvent(e) {
  const common = {
    id: `actual:${e.id}`,
    editable: false,
    classNames: ["cal-actual"],
    backgroundColor: COLOR.actual,
    borderColor: COLOR.actual,
    extendedProps: { type: "actual", sourceId: e.id },
  };
  const s = parseHM(e.start);
  const en = parseHM(e.end_time);
  if (s && en) {
    return { ...common, title: e.description || "Tracked", start: `${e.date}T${s}`, end: `${e.date}T${en}` };
  }
  const hrs = Math.round(((e.minutes || 0) / 60) * 10) / 10;
  return { ...common, title: `⏱ ${hrs}h`, start: e.date, allDay: true };
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

// ── writers (drag/resize reschedule + quick create) ────────────────────
export async function updateMeetingTime(id, startISO, endISO) {
  return supabase.from("scheduled_meetings")
    .update({ starts_at: startISO, ends_at: endISO, updated_at: new Date().toISOString() })
    .eq("id", id);
}
export async function updatePlannerSchedule(id, patch) {
  return supabase.from("planner_tasks").update(patch).eq("id", id);
}
export async function updateTaskDue(id, dueDate) {
  return supabase.from("planner_tasks").update({ due_date: dueDate }).eq("id", id);
}
export async function updatePersonalDue(id, dueDate) {
  return supabase.from("personal_tasks")
    .update({ due_date: dueDate, updated_at: new Date().toISOString() })
    .eq("id", id);
}
export async function createPlannerTask({ userId, title, plannerDate, startTime, durationMin }) {
  return supabase.from("planner_tasks").insert({
    user_id: userId,
    title,
    planner_date: plannerDate,
    start_time: startTime || null,
    duration_min: durationMin || null,
  }).select().single();
}
