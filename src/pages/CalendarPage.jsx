import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, Plus, CalendarClock, CheckSquare, User, Users, Home } from "lucide-react";
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
  googleEventToEvent, profileOooToEvents, businessHoursFromSettings,
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
const PERSONAL_ONLY = new Set(["tasks", "actuals", "google"]);
// Priority within a day: meetings + due dates surface first; tasks sink (and are
// the first to fall into "+N more"). Lower rank = shown higher.
const RANK = { meeting: 1, task_due: 1, ptask_due: 1, milestone: 2, google: 3, worklocation: 4, goal: 5, task: 7, actual: 8, ooo: 9 };
const UPCOMING_TYPES = new Set(["meeting", "task_due", "ptask_due", "milestone"]);
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
      if (layers.has("availability") && avail) availabilityToEvents(avail).forEach((e) => collected.push(e));
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
    // Stamp a priority rank so meetings/deadlines sort above tasks in each cell.
    collected.forEach((e) => { if (e.extendedProps) e.extendedProps.orderRank = RANK[e.extendedProps.type] ?? 6; });
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
  const toggleLayer = (layer) => setEnabledLayers((prev) => {
    const next = new Set(prev);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    try { localStorage.setItem(LS_LAYERS, JSON.stringify([...next])); } catch { /* */ }
    return next;
  });

  const businessHours = useMemo(() => (scope === "personal" && enabledLayers.has("availability") ? businessHoursFromSettings(avail) : false), [scope, enabledLayers, avail]);

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

  // ── derived: right-rail lists ──
  // Upcoming = meetings + due dates + milestones from ~now forward (what the user
  // cares about most), across days — NOT today's task checklist.
  const todayStr = toDateStr(new Date());
  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000; // keep ones started within the last hour
    return events
      .filter((e) => UPCOMING_TYPES.has(e.extendedProps?.type))
      .map((e) => ({ ...e, _s: new Date(e.start) }))
      .filter((e) => !Number.isNaN(e._s.getTime()) && e._s.getTime() >= cutoff)
      .sort((a, b) => a._s - b._s)
      .slice(0, 8);
  }, [events]);
  const taskRows = useMemo(() => events.filter((e) => e.extendedProps?.type === "task").slice(0, 10), [events]);

  const upcomingLabel = (e) => {
    const d = e._s;
    const isToday = toDateStr(d) === todayStr;
    const time = e.allDay ? "all-day" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return isToday ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time}`;
  };

  const scopes = [{ id: "personal", icon: User, label: "Mine" }, { id: "team", icon: Users, label: "Team" }];
  const visibleLegend = OCEAN_LEGEND.filter((l) => scope === "personal" || !PERSONAL_ONLY.has(l.layer));

  const chipContent = (arg) => {
    const p = arg.event.extendedProps || {};
    if (p.type === "ooo") return undefined; // background shading
    const meta = oceanType(p.type);
    const title = stripEmoji(arg.event.title);
    const timed = !arg.event.allDay && arg.event.start;
    const isTask = p.type === "task";
    const isDue = p.type === "task_due" || p.type === "ptask_due";
    const isLoc = p.type === "worklocation";
    const cls = ["cal-chip2"];
    if (isTask) cls.push("cal-chip2--task");
    else if (isDue) cls.push("cal-chip2--due");
    else if (isLoc) cls.push("cal-chip2--loc");
    if (p.done) cls.push("done");
    // Tasks + location are outlined (no fill); meetings/deadlines/etc. are filled tint.
    const style = (isTask || isLoc)
      ? { color: meta.fg, borderColor: meta.solid }
      : { background: meta.bg, color: meta.fg, borderColor: meta.solid };
    return (
      <div className={cls.join(" ")} style={style} title={title}>
        {isTask ? <span className="cbox" />
          : isLoc ? <Home className="w-3 h-3" style={{ opacity: 0.75 }} />
          : <span className="cdot" style={{ background: meta.solid }} />}
        {timed && !isTask && <span className="ctime">{arg.timeText}</span>}
        <span className="ctitle">{isLoc ? `Working: ${title}` : title}</span>
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
            <MiniMonth selected={focusDate} onPick={(d) => { api()?.gotoDate(d); setFocusDate(d); }} />
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
            {enabledLayers.has("google") && scope === "personal" && !googleConnected && (
              <button type="button" onClick={connectGoogle} className="cal-ocean__today" style={{ width: "100%", marginTop: 10, fontSize: 12 }}>
                Connect Google to sync
              </button>
            )}
          </div>
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
              businessHours={businessHours}
              nowIndicator
              firstDay={1}
              dayMaxEvents={4}
              slotMinTime="06:00:00"
              slotMaxTime="22:00:00"
              height="100%"
              eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            />
          </div>
        </main>

        {/* ── right rail ── */}
        <aside className="cal-ocean__rail cal-ocean__rail--right">
          <div className="cal-ocean__card">
            <div className="cal-ocean__cardhd"><CalendarClock className="w-[17px] h-[17px]" style={{ color: "var(--o-ocean-600)" }} /><h3>Upcoming</h3></div>
            {upcoming.length === 0 ? <p className="cal-ocean__empty">No upcoming meetings or deadlines.</p> : upcoming.map((e) => {
              const meta = oceanType(e.extendedProps?.type);
              return (
                <button key={e.id} type="button" className="cal-ocean__row" onClick={() => openDetails(e)}>
                  <span className="time" style={{ width: 72 }}>{upcomingLabel(e)}</span>
                  <span className="dot" style={{ background: meta.solid }} />
                  <span className="txt">{stripEmoji(e.title)}</span>
                </button>
              );
            })}
          </div>

          <div className="cal-ocean__card">
            <div className="cal-ocean__cardhd">
              <CheckSquare className="w-[17px] h-[17px]" style={{ color: "var(--o-mango-600)" }} /><h3>Tasks</h3>
              <span className="count">{taskRows.filter((t) => !t.extendedProps?.done).length} left</span>
            </div>
            {taskRows.length === 0 ? <p className="cal-ocean__empty">No planner tasks in view.</p> : taskRows.map((e) => {
              const row = e.extendedProps?.row || {};
              const done = !!e.extendedProps?.done;
              return (
                <div key={e.id} className="cal-ocean__row" style={{ cursor: "default" }}>
                  <button type="button" aria-label="Toggle done" onClick={() => toggleTaskDone(row)}
                    className="cal-ocean__box" style={{ borderColor: done ? "var(--o-aqua-500)" : "var(--o-ink-300)", background: done ? "var(--o-aqua-500)" : "transparent" }}>
                    {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                  <span className="txt" style={{ textDecoration: done ? "line-through" : "none", color: done ? "var(--o-ink-400)" : undefined }}>{stripEmoji(e.title)}</span>
                  {row.due_date && <span className="due">{new Date(row.due_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                </div>
              );
            })}
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
