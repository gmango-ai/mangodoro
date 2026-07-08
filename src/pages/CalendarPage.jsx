import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, Plus, CalendarClock, User, Users, Home, Target, Umbrella } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { listTeamGoals } from "../lib/goals";
import { listMilestonesInRange, updateMilestone } from "../lib/milestones";
import { getProfiles } from "../lib/profiles";
import {
  LAYERS, toDateStr, timeStrFromDate,
  fetchMeetingsInRange, fetchPlannerTasksInRange, fetchPlannerDueInRange,
  fetchPersonalDueInRange, fetchMyAvailability,
  meetingToEvent, plannerTaskToEvent, taskDueToEvent, personalDueToEvent,
  milestoneToEvent, goalToEvent, availabilityToEvents, entryToEvent,
  googleEventToEvent, profileOooToEvents,
  workLocationEvents, workHoursBackgroundEvents,
  updateMeetingTime, updatePlannerSchedule, updateTaskDue, updatePersonalDue,
  updatePlannerTaskFields, createPlannerTask,
} from "../lib/calendar";
import { oceanType, OCEAN_LEGEND } from "../components/calendar/oceanTheme";
import MiniMonth from "../components/calendar/MiniMonth";
import EventSlideOver from "../components/calendar/EventSlideOver";
import MilestoneModal from "../components/calendar/MilestoneModal";
import NewItemPopover from "../components/calendar/NewItemPopover";
import TaskEditModal from "../components/calendar/TaskEditModal";
import ScheduleMeetingModal from "../components/office/ScheduleMeetingModal";
import "../components/calendar/calendar-ocean.css";

const LS_LAYERS = "cal_layers";
const LS_SCOPE = "cal_scope";
const LS_WEEKSTART = "cal_weekstart";
const PERSONAL_ONLY = new Set(["tasks", "actuals", "google"]);
// Day reading order (lower = higher). CONTEXT band on top (OOO, goals, work
// location), then the "meat" — meetings + deadlines by priority — then tasks.
const RANK = {
  ooo: 0.0, goal: 0.1, worklocation_app: 0.2, worklocation: 0.25,
  task_due: 1.0, ptask_due: 1.0, milestone: 1.2, google: 1.4,
  task: 3.0, actual: 4.0,
};
const CTX_TYPES = new Set(["worklocation_app", "worklocation", "ooo", "goal"]);
const rankFor = (p) => (p?.type === "meeting"
  ? 1.0 - ((p.priority ?? 1) - 1) * 0.3   // high(2)=0.7 above deadlines · low(0)=1.3 below
  : RANK[p?.type] ?? 2);
const AGENDA_SKIP = new Set(["ooo_bg", "workhours"]);
const stripEmoji = (s) => String(s || "").replace(/^[⏳◆🏖⏱🎯]\s*/, "");
const eventDayStr = (e) => (e.allDay && typeof e.start === "string" && e.start.length === 10 ? e.start : toDateStr(new Date(e.start)));

function loadEnabledLayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LAYERS));
    if (Array.isArray(raw)) return new Set(raw.filter((l) => LAYERS.includes(l)));
  } catch { /* */ }
  return new Set(LAYERS.filter((l) => l !== "google"));
}

export default function CalendarPage() {
  const { session, entries, googleToken, googleTokenExpiry, connectGoogle, listGoogleCalendarEvents, updateCalendarEvent } = useApp();
  const { activeTeamId, rooms, teamMembers } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const userId = session?.user?.id;
  const googleConnected = !!googleToken && Date.now() < googleTokenExpiry;

  const [enabledLayers, setEnabledLayers] = useState(loadEnabledLayers);
  const [events, setEvents] = useState([]);
  const [avail, setAvail] = useState(null);
  const [teamProfiles, setTeamProfiles] = useState({});
  const [scope, setScope] = useState(() => { try { return localStorage.getItem(LS_SCOPE) || "personal"; } catch { return "personal"; } });
  const [weekStart, setWeekStart] = useState(() => { try { return localStorage.getItem(LS_WEEKSTART) === "0" ? 0 : 1; } catch { return 1; } });
  const [title, setTitle] = useState("");
  const [viewType, setViewType] = useState("dayGridMonth");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [detailEvent, setDetailEvent] = useState(null);
  const [newSlot, setNewSlot] = useState(null);
  const [milestoneModal, setMilestoneModal] = useState(null);
  const [meetingModal, setMeetingModal] = useState(null);
  const [taskEdit, setTaskEdit] = useState(null);

  const calRef = useRef(null);
  const rangeRef = useRef(null);
  const layersRef = useRef(enabledLayers); layersRef.current = enabledLayers;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const gcalRef = useRef(listGoogleCalendarEvents); gcalRef.current = listGoogleCalendarEvents;
  const gUpdateRef = useRef(updateCalendarEvent); gUpdateRef.current = updateCalendarEvent;

  useEffect(() => { if (userId) fetchMyAvailability(userId).then(({ data }) => setAvail(data || null)); }, [userId]);
  useEffect(() => {
    if (scope !== "team" || !teamMembers?.length) { setTeamProfiles({}); return; }
    getProfiles(teamMembers.map((m) => m.user_id).filter(Boolean)).then((map) => setTeamProfiles(map || {}));
  }, [scope, teamMembers]);

  const loadRange = useCallback(async (startDate, endDate) => {
    const layers = layersRef.current;
    const team = scopeRef.current === "team";
    const startStr = toDateStr(startDate);
    const endStr = toDateStr(endDate);
    const collected = [];
    const jobs = [];

    if (layers.has("meetings") && activeTeamId) {
      jobs.push(fetchMeetingsInRange(activeTeamId, startDate.toISOString(), endDate.toISOString())
        .then(({ data }) => (data || []).forEach((m) => collected.push(meetingToEvent(m)))));
    }
    if (layers.has("goals") && activeTeamId) {
      jobs.push(listTeamGoals(activeTeamId).then(({ data }) => {
        (data || []).filter((g) => g.week_start && g.week_start >= startStr && g.week_start < endStr)
          .forEach((g) => { const e = goalToEvent(g); if (e) collected.push(e); });
      }));
    }
    if (!team) {
      if (layers.has("tasks") && userId) {
        jobs.push(fetchPlannerTasksInRange(userId, startStr, endStr).then(({ data }) => (data || []).forEach((t) => collected.push(plannerTaskToEvent(t)))));
      }
      if (layers.has("deadlines") && userId) {
        jobs.push(fetchPlannerDueInRange(userId, startStr, endStr).then(({ data }) => (data || []).forEach((t) => collected.push(taskDueToEvent(t)))));
        jobs.push(fetchPersonalDueInRange(userId, startStr, endStr).then(({ data }) => (data || []).forEach((t) => collected.push(personalDueToEvent(t)))));
        if (activeTeamId) jobs.push(listMilestonesInRange(activeTeamId, startStr, endStr).then(({ data }) => (data || []).forEach((m) => collected.push(milestoneToEvent(m)))));
      }
      if (layers.has("availability") && avail) {
        availabilityToEvents(avail).forEach((e) => collected.push(e));
        workLocationEvents(avail, startDate, endDate).forEach((e) => collected.push(e));
        workHoursBackgroundEvents(avail, startDate, endDate).forEach((e) => collected.push(e));
      }
      if (layers.has("actuals")) (entries || []).filter((e) => e.date >= startStr && e.date < endStr).forEach((e) => collected.push(entryToEvent(e)));
      if (layers.has("google") && googleToken) {
        jobs.push(gcalRef.current?.({ timeMin: startDate.toISOString(), timeMax: endDate.toISOString() })
          .then((list) => (list || []).forEach((g) => collected.push(googleEventToEvent(g)))));
      }
    } else {
      if (layers.has("deadlines") && activeTeamId) jobs.push(listMilestonesInRange(activeTeamId, startStr, endStr).then(({ data }) => (data || []).filter((m) => m.scope === "team").forEach((m) => collected.push(milestoneToEvent(m)))));
      if (layers.has("availability")) Object.values(teamProfiles || {}).forEach((p) => profileOooToEvents(p).forEach((e) => collected.push(e)));
    }

    await Promise.all(jobs);
    // Stamp reading-order rank: context band → meetings/deadlines (by priority) → tasks.
    collected.forEach((e) => { if (e.extendedProps) e.extendedProps.orderRank = rankFor(e.extendedProps); });
    setEvents(collected);
  }, [activeTeamId, userId, avail, entries, teamProfiles, googleToken]);

  const reload = useCallback(() => { if (rangeRef.current) loadRange(rangeRef.current.start, rangeRef.current.end); }, [loadRange]);

  const onDatesSet = useCallback((arg) => {
    rangeRef.current = { start: arg.start, end: arg.end };
    setTitle(arg.view.title);
    setViewType(arg.view.type);
    setFocusDate(arg.view.currentStart);
    loadRange(arg.start, arg.end);
  }, [loadRange]);

  useEffect(() => { reload(); }, [enabledLayers, scope, reload]);

  const api = () => calRef.current?.getApi();
  const changeScope = (id) => { setScope(id); try { localStorage.setItem(LS_SCOPE, id); } catch { /* */ } };
  const changeWeekStart = (v) => { setWeekStart(v); try { localStorage.setItem(LS_WEEKSTART, String(v)); } catch { /* */ } };
  const toggleLayer = (layer) => setEnabledLayers((prev) => {
    const next = new Set(prev);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    try { localStorage.setItem(LS_LAYERS, JSON.stringify([...next])); } catch { /* */ }
    return next;
  });


  const onEventChange = useCallback(async (info) => {
    const p = info.event.extendedProps || {};
    const start = info.event.start; const end = info.event.end;
    let res = { error: null };
    if (p.type === "meeting") {
      const endDate = end || new Date(start.getTime() + 30 * 60000);
      res = await updateMeetingTime(p.sourceId, start.toISOString(), endDate.toISOString());
      if (!res.error && p.googleEventId) gUpdateRef.current?.(p.googleEventId, { start, end: endDate });
    } else if (p.type === "task") {
      res = info.event.allDay
        ? await updatePlannerSchedule(p.sourceId, { planner_date: toDateStr(start), start_time: null, duration_min: null })
        : await updatePlannerSchedule(p.sourceId, { planner_date: toDateStr(start), start_time: timeStrFromDate(start), duration_min: end ? Math.round((end - start) / 60000) : 60 });
    } else if (p.type === "task_due") res = await updateTaskDue(p.sourceId, toDateStr(start));
    else if (p.type === "ptask_due") res = await updatePersonalDue(p.sourceId, toDateStr(start));
    else if (p.type === "milestone") res = await updateMilestone(p.sourceId, info.event.allDay ? { milestone_date: toDateStr(start), milestone_time: null } : { milestone_date: toDateStr(start), milestone_time: timeStrFromDate(start) });
    else { info.revert(); return; }
    if (res.error) info.revert();
  }, []);

  const openDetails = useCallback((ev) => setDetailEvent({ title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay, extendedProps: ev.extendedProps || {} }), []);
  const createTask = async (t) => {
    if (!newSlot || !userId) return;
    const s = newSlot.start;
    await createPlannerTask({ userId, title: t, plannerDate: toDateStr(s), startTime: newSlot.allDay ? null : timeStrFromDate(s), durationMin: !newSlot.allDay && newSlot.end ? Math.round((newSlot.end - s) / 60000) : null });
    reload();
  };
  const toggleTaskDone = async (row) => { await updatePlannerTaskFields(row.id, { done: !row.done }); reload(); };

  // ── right-rail agenda: everything from ~now forward, sorted by time, with
  // consecutive same-type items clustered (grouped by type around a similar time). ──
  const todayStr = toDateStr(new Date());
  const agenda = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const items = events
      .filter((e) => e.display !== "background" && !AGENDA_SKIP.has(e.extendedProps?.type))
      .map((e) => ({ ...e, _s: new Date(e.start), _rank: e.extendedProps?.orderRank ?? 2 }))
      .filter((e) => !Number.isNaN(e._s.getTime()) && e._s >= startOfToday)
      .sort((a, b) => a._s - b._s || a._rank - b._rank);
    const days = [];
    let curKey = null;
    for (const it of items) {
      const k = toDateStr(it._s);
      if (k !== curKey) { days.push({ key: k, date: new Date(it._s), runs: [] }); curKey = k; }
      const day = days[days.length - 1];
      const type = it.extendedProps?.type;
      const last = day.runs[day.runs.length - 1];
      if (last && last.type === type) last.items.push(it);
      else day.runs.push({ type, items: [it] });
    }
    return days.slice(0, 10);
  }, [events]);

  const dayHeading = (d) => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const tm = new Date(t); tm.setDate(t.getDate() + 1);
    if (toDateStr(d) === toDateStr(t)) return "Today";
    if (toDateStr(d) === toDateStr(tm)) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  const scopes = [{ id: "personal", icon: User, label: "Mine" }, { id: "team", icon: Users, label: "Team" }];
  const visibleLegend = OCEAN_LEGEND.filter((l) => scope === "personal" || !PERSONAL_ONLY.has(l.layer));

  const chipContent = (arg) => {
    if (arg.event.display === "background") return undefined; // OOO/work-hours shading
    const p = arg.event.extendedProps || {};
    const meta = oceanType(p.type);
    const title = stripEmoji(arg.event.title);
    const timed = !arg.event.allDay && arg.event.start;

    // Day-context band (compact, muted): work location, goals, OOO.
    if (CTX_TYPES.has(p.type)) {
      const isLoc = p.type === "worklocation" || p.type === "worklocation_app";
      const Icon = isLoc ? Home : p.type === "goal" ? Target : Umbrella;
      return (
        <div className="cal-chip2 cal-chip2--ctx" style={{ color: meta.fg }} title={title}>
          <Icon /><span className="ctitle">{title}</span>
        </div>
      );
    }

    const isTask = p.type === "task";
    const isDue = p.type === "task_due" || p.type === "ptask_due";
    const isLoc = p.type === "worklocation";
    const cls = ["cal-chip2"];
    if (isTask) cls.push("cal-chip2--task");
    else if (isDue) cls.push("cal-chip2--due");
    else if (isLoc) cls.push("cal-chip2--loc");
    if (p.done) cls.push("done");
    const style = isTask ? { color: meta.fg, borderColor: meta.solid } : { background: meta.bg, color: meta.fg, borderColor: meta.solid };
    return (
      <div className={cls.join(" ")} style={style} title={title}>
        {isTask ? <span className="cbox" /> : <span className="cdot" style={{ background: meta.solid }} />}
        {timed && !isTask && <span className="ctime">{arg.timeText}</span>}
        <span className="ctitle">{title}</span>
      </div>
    );
  };

  return (
    <div className="cal-ocean">
      <div className="cal-ocean__shell">
        {/* ── left rail ── */}
        <aside className="cal-ocean__rail cal-ocean__rail--left">
          <div className="cal-ocean__seg" style={{ width: "100%", marginBottom: 16 }}>
            {scopes.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => changeScope(s.id)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Icon className="w-3.5 h-3.5" /> {s.label}
                </button>
              );
            })}
          </div>

          <div className="cal-ocean__card" style={{ padding: 12 }}>
            <MiniMonth selected={focusDate} weekStart={weekStart} onPick={(d) => { api()?.gotoDate(d); setFocusDate(d); }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: "var(--o-ink-400)", fontWeight: 700 }}>Week starts</span>
              <div className="cal-ocean__seg" style={{ marginLeft: "auto" }}>
                <button type="button" aria-pressed={weekStart === 0} onClick={() => changeWeekStart(0)}>Sun</button>
                <button type="button" aria-pressed={weekStart === 1} onClick={() => changeWeekStart(1)}>Mon</button>
              </div>
            </div>
          </div>

          <div className="cal-ocean__card">
            <div className="cal-ocean__eyebrow">My calendars</div>
            {visibleLegend.map((l) => {
              const on = enabledLayers.has(l.layer);
              return (
                <div key={l.layer} className={`cal-ocean__filter ${on ? "" : "off"}`} onClick={() => toggleLayer(l.layer)} role="button" tabIndex={0}>
                  <span className="cal-ocean__box" style={{ borderColor: l.solid, background: on ? l.solid : "transparent" }}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <span className="lbl">{l.label}</span>
                </div>
              );
            })}
          </div>

          {scope === "personal" && (
            <div className="cal-ocean__card">
              <div className="cal-ocean__eyebrow">Google Calendar</div>
              {googleConnected ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: "var(--o-aqua-600)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--o-aqua-500)" }} /> Connected
                    </span>
                    <button type="button" onClick={reload} className="cal-ocean__today" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}>Refresh</button>
                  </div>
                  {!enabledLayers.has("google") && (
                    <button type="button" onClick={() => toggleLayer("google")} className="cal-ocean__today" style={{ width: "100%", marginTop: 8, fontSize: 12 }}>
                      Show Google events
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p style={{ fontSize: 11.5, color: "var(--o-ink-500)", margin: "0 0 8px", lineHeight: 1.4 }}>
                    Show your Google events here and keep scheduled meetings in sync.
                  </p>
                  <button type="button" onClick={() => { if (!enabledLayers.has("google")) toggleLayer("google"); connectGoogle(); }} className="cal-ocean__new" style={{ width: "100%", justifyContent: "center" }}>
                    Connect Google Calendar
                  </button>
                </>
              )}
            </div>
          )}
        </aside>

        {/* ── main ── */}
        <main className="cal-ocean__main">
          <header className="cal-ocean__toolbar">
            <span className="cal-ocean__title">{title}</span>
            <button type="button" className="cal-ocean__navbtn" aria-label="Previous" onClick={() => api()?.prev()}><ChevronLeft className="w-[18px] h-[18px]" /></button>
            <button type="button" className="cal-ocean__navbtn" aria-label="Next" onClick={() => api()?.next()}><ChevronRight className="w-[18px] h-[18px]" /></button>
            <button type="button" className="cal-ocean__today" onClick={() => api()?.today()}>Today</button>
            <span className="cal-ocean__spacer" />
            <div className="cal-ocean__seg">
              {[["dayGridMonth", "Month"], ["timeGridWeek", "Week"], ["timeGridDay", "Day"]].map(([v, lbl]) => (
                <button key={v} type="button" aria-pressed={viewType === v} onClick={() => api()?.changeView(v)}>{lbl}</button>
              ))}
            </div>
            <button type="button" className="cal-ocean__new" onClick={() => setNewSlot({ start: focusDate || new Date(), end: null, allDay: true })}>
              <Plus className="w-4 h-4" /> New event
            </button>
          </header>

          <div className="cal-ocean__gridwrap">
            <FullCalendar
              ref={calRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={false}
              events={events}
              eventContent={chipContent}
              eventOrder="orderRank,start,title"
              datesSet={onDatesSet}
              eventClick={(info) => openDetails(info.event)}
              editable
              selectable
              selectMirror
              select={(arg) => setNewSlot({ start: arg.start, end: arg.end, allDay: arg.allDay })}
              eventDrop={onEventChange}
              eventResize={onEventChange}
              nowIndicator
              firstDay={weekStart}
              dayMaxEvents={4}
              slotMinTime="06:00:00"
              slotMaxTime="22:00:00"
              height="100%"
              eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            />
          </div>
        </main>

        {/* ── right rail: unified time-grouped agenda ── */}
        <aside className="cal-ocean__rail cal-ocean__rail--right">
          <div className="cal-ocean__card">
            <div className="cal-ocean__cardhd"><CalendarClock className="w-[17px] h-[17px]" style={{ color: "var(--o-ocean-600)" }} /><h3>Agenda</h3></div>
            {agenda.length === 0 ? <p className="cal-ocean__empty">Nothing coming up.</p> : agenda.map((day) => (
              <div key={day.key} className="cal-ocean__aday">
                <div className="cal-ocean__adayhd">{dayHeading(day.date)}</div>
                {day.runs.map((run, ri) => {
                  const meta = oceanType(run.type);
                  return (
                    <div key={ri} className="cal-ocean__run">
                      {run.items.length > 1 && <div className="cal-ocean__runlabel" style={{ color: meta.solid }}>{meta.label}</div>}
                      {run.items.map((it) => {
                        const isTask = it.extendedProps?.type === "task";
                        const done = !!it.extendedProps?.done;
                        const row = it.extendedProps?.row || {};
                        return (
                          <div key={it.id} className="cal-ocean__row">
                            <span className="time">{it.allDay ? "" : it._s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                            {isTask ? (
                              <button type="button" aria-label="Toggle done" onClick={() => toggleTaskDone(row)}
                                className="cal-ocean__box" style={{ borderColor: done ? "var(--o-aqua-500)" : "var(--o-ink-300)", background: done ? "var(--o-aqua-500)" : "transparent" }}>
                                {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                              </button>
                            ) : <span className="dot" style={{ background: meta.solid }} />}
                            <button type="button" className="txt" onClick={() => openDetails(it)}
                              style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", textDecoration: done ? "line-through" : "none", color: done ? "var(--o-ink-400)" : undefined }}>
                              {stripEmoji(it.title)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* ── slide-over + modals ── */}
      {detailEvent && (
        <EventSlideOver
          ev={detailEvent}
          rooms={rooms}
          onClose={() => setDetailEvent(null)}
          onGo={(path) => { setDetailEvent(null); navigate(path); }}
          onEditMeeting={(row) => { setDetailEvent(null); setMeetingModal({ meeting: row }); }}
          onEditMilestone={(row) => { setDetailEvent(null); setMilestoneModal({ milestone: row }); }}
          onEditTask={(row, kind) => { setDetailEvent(null); setTaskEdit({ task: row, kind }); }}
        />
      )}
      {newSlot && (
        <NewItemPopover
          dark={dark}
          slotLabel={newSlot.allDay ? newSlot.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : newSlot.start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          onClose={() => setNewSlot(null)}
          onCreateTask={createTask}
          onPickMilestone={() => setMilestoneModal({ initialDate: toDateStr(newSlot.start) })}
          onPickMeeting={() => setMeetingModal({ initialStart: newSlot.start })}
        />
      )}
      {milestoneModal && (
        <MilestoneModal teamId={activeTeamId} dark={dark} initialDate={milestoneModal.initialDate} milestone={milestoneModal.milestone} onClose={() => setMilestoneModal(null)} onSaved={reload} />
      )}
      {meetingModal && (
        <ScheduleMeetingModal rooms={rooms} teamId={activeTeamId} dark={dark} initialStart={meetingModal.initialStart} meeting={meetingModal.meeting} onClose={() => setMeetingModal(null)} onCreated={reload} onDeleted={reload} />
      )}
      {taskEdit && (
        <TaskEditModal task={taskEdit.task} kind={taskEdit.kind} dark={dark} onClose={() => setTaskEdit(null)} onSaved={reload} />
      )}
    </div>
  );
}
