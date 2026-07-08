import { supabase } from "../supabase";

// Data layer + FullCalendar mappers for the unified calendar (/calendar).
//
// Each "layer" has a fetcher (range-scoped DB read) and a pure mapper
// (row -> FullCalendar event input). The page loads enabled layers for the
// visible range on `datesSet` and concatenates the mapped events.

export const LAYERS = ["meetings", "tasks", "deadlines", "goals", "availability", "actuals", "google"];
export const LAYER_LABEL = {
  meetings: "Meetings",
  tasks: "Planner tasks",
  deadlines: "Deadlines",
  goals: "Goals",
  availability: "Work hours & OOO",
  actuals: "Time tracked",
  google: "Google Calendar",
};

const COLOR = {
  meeting: "#14b8a6",
  task: "#6366f1",
  due: "#ef4444",
  milestone: "#a855f7",
  goal: "#f59e0b",
  ooo: "rgba(100,116,139,0.18)",
  actual: "#94a3b8",
  google: "#4285F4",
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
    .select("id, room_id, title, description, starts_at, ends_at, created_by, google_event_id, google_html_link, auto_record, attendee_ids, attendee_emails")
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
    .select("work_start, work_end, work_days, work_schedule, ooo_start, ooo_end, ooo_note, ooo_ranges")
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
    extendedProps: { type: "meeting", sourceId: m.id, roomId: m.room_id, googleEventId: m.google_event_id, row: m },
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
    extendedProps: { type: "task", sourceId: t.id, done: t.done, row: t },
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
    extendedProps: { type: "task_due", sourceId: t.id, row: t },
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
    extendedProps: { type: "ptask_due", sourceId: t.id, row: t },
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
    extendedProps: { type: "actual", sourceId: e.id, row: e },
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
    extendedProps: { type: "goal", sourceId: g.id, row: g },
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

// A read-only event pulled from the user's Google Calendar. Working-location
// entries (home/office) get their own type so the calendar renders them as a
// location badge rather than a meeting-style chip.
export function googleEventToEvent(g) {
  const isLocation = g.eventType === "workingLocation";
  return {
    id: `google:${g.id}`,
    title: isLocation ? (g.locationLabel || g.title) : g.title,
    start: g.start,
    end: g.end,
    allDay: g.allDay,
    editable: false,
    classNames: ["cal-google"],
    extendedProps: {
      type: isLocation ? "worklocation" : "google",
      htmlLink: g.htmlLink,
      locationLabel: g.locationLabel,
    },
  };
}

// Team view: a teammate's OOO as a named all-day chip (so you can see WHO is out).
export function profileOooToEvents(profile) {
  if (!profile) return [];
  const name = profile.display_name || "Teammate";
  const out = [];
  const push = (start, end, key) => {
    if (!start) return;
    out.push({
      id: `ooo:${profile.user_id}:${key}`,
      title: `🏖 ${name}`,
      start,
      end: addDaysStr(end || start, 1),
      allDay: true,
      backgroundColor: "rgba(100,116,139,0.22)",
      borderColor: "transparent",
      textColor: "#64748b",
      editable: false,
      extendedProps: { type: "ooo", note: `${name} out of office` },
    });
  };
  if (profile.ooo_start) push(profile.ooo_start, profile.ooo_end, "primary");
  (Array.isArray(profile.ooo_ranges) ? profile.ooo_ranges : []).forEach((r, i) => push(r.start, r.end, `r${i}`));
  return out;
}

// FullCalendar businessHours from work_start/work_end/work_days.
const DAY_NUM = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
export function businessHoursFromSettings(settings) {
  if (!settings) return false;
  // Prefer the per-day work_schedule (what Settings writes): each day key (0=Sun..6)
  // → { start, end, loc }. Produce one businessHours entry per configured day.
  const sched = settings.work_schedule && typeof settings.work_schedule === "object" ? settings.work_schedule : null;
  if (sched && Object.keys(sched).length) {
    const arr = Object.entries(sched)
      .filter(([, v]) => v && v.start && v.end)
      .map(([d, v]) => ({ daysOfWeek: [Number(d)], startTime: String(v.start).slice(0, 5), endTime: String(v.end).slice(0, 5) }));
    if (arr.length) return arr;
  }
  // Fall back to the flat work_start/work_end + work_days.
  if (!settings.work_start || !settings.work_end) return false;
  const days = Array.isArray(settings.work_days) && settings.work_days.length
    ? settings.work_days.map((d) => (typeof d === "number" ? d : DAY_NUM[String(d).toLowerCase()])).filter((d) => d !== undefined)
    : [1, 2, 3, 4, 5];
  return { daysOfWeek: days, startTime: String(settings.work_start).slice(0, 5), endTime: String(settings.work_end).slice(0, 5) };
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

export async function updatePlannerTaskFields(id, patch) {
  return supabase.from("planner_tasks").update(patch).eq("id", id);
}
export async function deletePlannerTask(id) {
  return supabase.from("planner_tasks").delete().eq("id", id);
}
export async function updatePersonalTaskFields(id, patch) {
  return supabase.from("personal_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}
export async function deletePersonalTask(id) {
  return supabase.from("personal_tasks").delete().eq("id", id);
}
