import { supabase } from "../supabase";

// Data layer + FullCalendar mappers for the unified calendar (/calendar).
//
// Each "layer" has a fetcher (range-scoped DB read) and a pure mapper
// (row -> FullCalendar event input). The page loads enabled layers for the
// visible range on `datesSet` and concatenates the mapped events.

export const LAYERS = ["meetings", "tasks", "deadlines", "goals", "availability", "actuals", "google", "company"];
export const LAYER_LABEL = {
  meetings: "Meetings",
  tasks: "Planner tasks",
  deadlines: "Deadlines",
  goals: "Goals",
  availability: "Work hours & OOO",
  actuals: "Time tracked",
  google: "Google Calendar",
  company: "Company (Google)",
};

// Event category colors. These are CSS custom properties defined on `.cal-ocean`
// (see calendar-ocean.css) and DERIVED FROM THE USER'S ACCENT via color-theory
// hue offsets, so the whole calendar harmonizes with the accent and adapts to
// light/dark. Passed straight to FullCalendar as inline style strings — the
// var() resolves against the .cal-ocean container. Hex fallbacks preserve the
// original palette if a browser lacks relative-color support.
const COLOR = {
  meeting: "var(--cal-cat-meeting, #14b8a6)",
  task: "var(--cal-cat-task, #6366f1)",
  due: "var(--cal-cat-due, #ef4444)",
  milestone: "var(--cal-cat-milestone, #a855f7)",
  goal: "var(--cal-cat-goal, #f59e0b)",
  ooo: "var(--cal-cat-ooo, rgba(100,116,139,0.18))",
  actual: "var(--cal-cat-actual, #94a3b8)",
  google: "var(--cal-cat-google, #4285F4)",
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
    .select("id, room_id, title, description, starts_at, ends_at, created_by, google_event_id, google_html_link, auto_record, attendee_ids, attendee_emails, priority")
    .eq("team_id", teamId)
    .gte("starts_at", startISO)
    .lte("starts_at", endISO)
    .order("starts_at");
}

export async function fetchPlannerTasksInRange(userId, startDate, endDate) {
  if (!userId) return { data: [] };
  return supabase
    .from("planner_tasks")
    .select("id, planner_date, due_date, start_time, duration_min, title, done, status, in_progress, priority, progress, points_awarded_for_task, notes, deadline, labels, focus_sessions")
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
    .select("id, due_date, planner_date, title, done, status, in_progress, priority, progress, points_awarded_for_task, notes, deadline, labels, focus_sessions")
    .eq("user_id", userId)
    .not("due_date", "is", null)
    .gte("due_date", startDate)
    .lte("due_date", endDate);
}

export async function fetchPersonalDueInRange(userId, startDate, endDate) {
  if (!userId) return { data: [] };
  return supabase
    .from("personal_tasks")
    .select("id, due_date, title, done, status, deadline, labels")
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
    .select("work_start, work_end, work_days, work_schedule, work_location_overrides, ooo_start, ooo_end, ooo_note, ooo_ranges")
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
    extendedProps: { type: "meeting", sourceId: m.id, roomId: m.room_id, googleEventId: m.google_event_id, priority: m.priority ?? 1, row: m },
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

// The week-start day (0=Sun..6) on or before a date — so a goal's Monday-anchored
// week aligns to the calendar's chosen first day (spans that whole 7-day row).
function weekStartOnOrBefore(dateStr, weekStartDow) {
  const d = new Date(`${dateStr}T00:00:00`);
  const diff = (d.getDay() - weekStartDow + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toDateStr(d);
}

// A goal's calendar span (exclusive end), or null if it shouldn't sit on the
// grid. Week goals span their week (aligned to weekStart). Month goals span the
// month they were set in (set_at) — month/quarter/year carry no explicit period,
// so we anchor month goals to their set date. Quarter/year/none are "ongoing"
// (null here) and belong in the side list, not the grid.
export function goalGridSpan(g, weekStart = 1) {
  if (g.horizon === "week" && g.week_start) {
    const s = weekStartOnOrBefore(g.week_start, weekStart);
    return { start: s, end: addDaysStr(s, 7) };
  }
  if (g.horizon === "month") {
    const anchor = g.set_at || g.created_at;
    if (!anchor) return null;
    const d = new Date(anchor);
    if (Number.isNaN(d.getTime())) return null;
    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    return { start: first, end: toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
  }
  return null;
}

export function isOngoingGoal(g) {
  return !["week", "month"].includes(g.horizon) || (g.horizon === "week" && !g.week_start);
}

// Goal → an all-day banner spanning its period. Returns null for ongoing goals.
// `collapsed` renders a thin bar (you see a goal is set, but not its text).
export function goalToEvent(g, weekStart = 1, collapsed = false) {
  const span = goalGridSpan(g, weekStart);
  if (!span) return null;
  return {
    id: `goal:${g.id}`,
    title: `🎯 ${g.body || "Goal"}`,
    start: span.start,
    end: span.end,
    allDay: true,
    display: "block",
    editable: false,
    classNames: collapsed ? ["cal-span", "cal-span-goal", "cal-goal-min"] : ["cal-span", "cal-span-goal"],
    extendedProps: { type: "goal", sourceId: g.id, collapsed, row: g },
  };
}

// OOO ranges → a labeled context chip at the top of the day PLUS a soft
// background tint over the range.
export function availabilityToEvents(settings) {
  if (!settings) return [];
  const out = [];
  const push = (start, end, note, key) => {
    if (!start) return;
    const endEx = addDaysStr(end || start, 1); // inclusive end → FC exclusive
    out.push({
      id: `oobg:${key}`, start, end: endEx, allDay: true, display: "background",
      backgroundColor: COLOR.ooo, extendedProps: { type: "ooo_bg" },
    });
    out.push({
      id: `ooo:${key}`, start, end: endEx, allDay: true, editable: false, display: "block",
      classNames: ["cal-span", "cal-span-ooo"], // filled bar spanning the OOO range
      title: note || "Out of office", extendedProps: { type: "ooo", note: note || "Out of office" },
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

// ── Company events (Google → shared team calendar) ─────────────────────────
// Company events live mixed into the user's PERSONAL Google calendar, so there's
// no built-in "this is a company event" flag. We infer a candidate by whether
// someone OTHER than you, on your company email domain, is involved (organizer
// or attendee) — self-only personal events (gym, dentist) have no such person,
// so they stay out. It's a SUGGESTION only: the user confirms before anything is
// shared to the team (see CompanyEventsReview).

export function emailDomain(email) {
  const s = String(email || "").toLowerCase().trim();
  const at = s.lastIndexOf("@");
  return at >= 0 ? s.slice(at + 1) : "";
}

export function isLikelyCompanyEvent(raw, { companyDomain, myEmail } = {}) {
  if (!companyDomain) return false;
  const my = String(myEmail || "").toLowerCase();
  const people = [raw.organizer?.email, ...((raw.attendees || []).map((a) => a?.email))]
    .map((e) => String(e || "").toLowerCase())
    .filter((e) => e && e !== my);
  return people.some((e) => emailDomain(e) === companyDomain);
}

// A raw Google primary event → a company-event candidate. The dedupe key is
// per-OCCURRENCE: `iCalUID` (NOT the per-calendar `id`) collapses the same
// meeting across every attendee's calendar, but `singleEvents=true` expands a
// recurring series into instances that ALL share one iCalUID — so we append the
// occurrence's absolute start (UTC, so it's identical regardless of each
// attendee's timezone rendering). That keeps every instance a distinct row while
// still deduping the same instance across teammates (and avoids an upsert batch
// touching one row twice — Postgres rejects that).
export function occurrenceKey(raw) {
  const base = raw.iCalUID || raw.id || "";
  const startRaw = raw.start?.dateTime || raw.start?.date || null;
  if (!startRaw) return base;
  const d = new Date(startRaw);
  return Number.isNaN(d.getTime()) ? base : `${base}::${d.toISOString()}`;
}

export function googleRawToCompanyCandidate(raw) {
  // `recurringEventId` is the master series' id, shared by every expanded
  // instance — so the review UI can collapse a series to one row (and let the
  // user drill in to pick specific occurrences). Null for one-off events.
  const seriesId = raw.recurringEventId || null;
  return {
    icalUid: occurrenceKey(raw),
    seriesId,
    recurring: !!seriesId,
    googleEventId: raw.id,
    title: raw.summary || "(busy)",
    start: raw.start?.dateTime || raw.start?.date,
    end: raw.end?.dateTime || raw.end?.date,
    allDay: !raw.start?.dateTime,
    location: raw.location || null,
    htmlLink: raw.htmlLink || null,
    organizerEmail: raw.organizer?.email || null,
  };
}

// A published company-event DB row → FullCalendar event (visible to the whole team).
export function companyEventToEvent(row) {
  return {
    id: `company:${row.ical_uid}`,
    title: row.title,
    start: row.starts_at,
    end: row.ends_at || undefined,
    allDay: !!row.all_day,
    editable: false,
    classNames: ["cal-company"],
    extendedProps: {
      type: "company",
      htmlLink: row.html_link,
      location: row.location,
      organizerEmail: row.organizer_email,
      icalUid: row.ical_uid,
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

// Day-context: the app's per-day work LOCATION (from work_schedule[weekday].loc)
// as a compact all-day chip at the top of each working day in the range.
const LOC_LABEL = { office: "Office", home: "Home", remote: "Remote", out: "Out" };
export function workLocationEvents(settings, startDate, endDate) {
  const sched = settings?.work_schedule && typeof settings.work_schedule === "object" ? settings.work_schedule : null;
  if (!sched) return [];
  const out = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  for (; d < end; d.setDate(d.getDate() + 1)) {
    const day = sched[d.getDay()];
    if (!day || !day.loc) continue;
    const ds = toDateStr(d);
    out.push({
      id: `wloc:${ds}`,
      title: LOC_LABEL[day.loc] || day.loc,
      start: ds,
      allDay: true,
      editable: false,
      extendedProps: { type: "worklocation_app", loc: day.loc },
    });
  }
  return out;
}

// Week/Day: color-in the working hours as a soft background band per day.
export function workHoursBackgroundEvents(settings, startDate, endDate) {
  const sched = settings?.work_schedule && typeof settings.work_schedule === "object" ? settings.work_schedule : null;
  const flat = (!sched || !Object.keys(sched).length) && settings?.work_start && settings?.work_end;
  const out = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  for (; d < end; d.setDate(d.getDate() + 1)) {
    let s, e;
    if (sched && sched[d.getDay()]?.start && sched[d.getDay()]?.end) { s = sched[d.getDay()].start; e = sched[d.getDay()].end; }
    else if (flat) { s = settings.work_start; e = settings.work_end; }
    else continue;
    const ds = toDateStr(d);
    out.push({
      id: `whrs:${ds}`,
      start: `${ds}T${String(s).slice(0, 5)}`,
      end: `${ds}T${String(e).slice(0, 5)}`,
      display: "background",
      backgroundColor: "rgba(45,127,249,0.08)",
      extendedProps: { type: "workhours" },
    });
  }
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

// Persist the full per-date work-location override map (YYYY-MM-DD → label).
export async function saveWorkLocationOverrides(userId, overrides) {
  if (!userId) return { error: { message: "no user" } };
  return supabase.from("user_settings").update({ work_location_overrides: overrides }).eq("user_id", userId);
}

// The user's open planner tasks (for the calendar's Tasks card), independent of
// what's placed on the grid — scheduled ones first, then undated backlog.
export async function fetchOpenPlannerTasks(userId, limit = 20) {
  if (!userId) return { data: [] };
  return supabase
    .from("planner_tasks")
    .select("id, planner_date, due_date, title, done, status, archived, in_progress, priority, progress, points_awarded_for_task, deadline, labels, notes, focus_sessions")
    .eq("user_id", userId)
    .eq("done", false)
    .eq("archived", false)
    .order("planner_date", { ascending: true, nullsFirst: false })
    .limit(limit);
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
