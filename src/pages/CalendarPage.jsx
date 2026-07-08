import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { Plus, Calendar, List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { listTeamGoals } from "../lib/goals";
import { listMilestonesInRange, updateMilestone } from "../lib/milestones";
import {
  LAYERS, LAYER_LABEL,
  toDateStr, timeStrFromDate,
  fetchMeetingsInRange, fetchPlannerTasksInRange, fetchPlannerDueInRange,
  fetchPersonalDueInRange, fetchMyAvailability,
  meetingToEvent, plannerTaskToEvent, taskDueToEvent, personalDueToEvent,
  milestoneToEvent, goalToEvent, availabilityToEvents, entryToEvent,
  businessHoursFromSettings,
  updateMeetingTime, updatePlannerSchedule, updateTaskDue, updatePersonalDue,
  createPlannerTask,
} from "../lib/calendar";
import MilestoneModal from "../components/calendar/MilestoneModal";
import NewItemPopover from "../components/calendar/NewItemPopover";
import EventList from "../components/calendar/EventList";
import ScheduleMeetingModal from "../components/office/ScheduleMeetingModal";
import "../components/calendar/calendar.css";

const LS_LAYERS = "cal_layers";
const LS_VIEW = "cal_view";
const LS_DISPLAY = "cal_display";
const CAL_HEIGHT = 660;

const LAYER_DOT = {
  meetings: "#14b8a6", tasks: "#6366f1", deadlines: "#ef4444",
  goals: "#f59e0b", availability: "#64748b", actuals: "#94a3b8",
};
const DISPLAY_MODES = [
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "both", icon: LayoutGrid, label: "Both" },
  { id: "list", icon: List, label: "List" },
];

function loadEnabledLayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LAYERS));
    if (Array.isArray(raw)) return new Set(raw.filter((l) => LAYERS.includes(l)));
  } catch { /* */ }
  return new Set(LAYERS);
}

export default function CalendarPage() {
  const { session, entries } = useApp();
  const { activeTeamId, rooms } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const userId = session?.user?.id;

  const [enabledLayers, setEnabledLayers] = useState(loadEnabledLayers);
  const [events, setEvents] = useState([]);
  const [avail, setAvail] = useState(null);
  const [displayMode, setDisplayMode] = useState(() => {
    try { return localStorage.getItem(LS_DISPLAY) || "calendar"; } catch { return "calendar"; }
  });
  const [newSlot, setNewSlot] = useState(null);
  const [milestoneModal, setMilestoneModal] = useState(null);
  const [meetingModal, setMeetingModal] = useState(null);

  const initialView = (() => {
    try { return localStorage.getItem(LS_VIEW) || "dayGridMonth"; } catch { return "dayGridMonth"; }
  })();

  const rangeRef = useRef(null);
  const layersRef = useRef(enabledLayers);
  layersRef.current = enabledLayers;

  useEffect(() => {
    if (!userId) return;
    fetchMyAvailability(userId).then(({ data }) => setAvail(data || null));
  }, [userId]);

  const loadRange = useCallback(async (startDate, endDate) => {
    const layers = layersRef.current;
    const startStr = toDateStr(startDate);
    const endStr = toDateStr(endDate);
    const collected = [];
    const jobs = [];

    if (layers.has("meetings") && activeTeamId) {
      jobs.push(fetchMeetingsInRange(activeTeamId, startDate.toISOString(), endDate.toISOString())
        .then(({ data }) => (data || []).forEach((m) => collected.push(meetingToEvent(m)))));
    }
    if (layers.has("tasks") && userId) {
      jobs.push(fetchPlannerTasksInRange(userId, startStr, endStr)
        .then(({ data }) => (data || []).forEach((t) => collected.push(plannerTaskToEvent(t)))));
    }
    if (layers.has("deadlines") && userId) {
      jobs.push(fetchPlannerDueInRange(userId, startStr, endStr)
        .then(({ data }) => (data || []).forEach((t) => collected.push(taskDueToEvent(t)))));
      jobs.push(fetchPersonalDueInRange(userId, startStr, endStr)
        .then(({ data }) => (data || []).forEach((t) => collected.push(personalDueToEvent(t)))));
      if (activeTeamId) {
        jobs.push(listMilestonesInRange(activeTeamId, startStr, endStr)
          .then(({ data }) => (data || []).forEach((m) => collected.push(milestoneToEvent(m)))));
      }
    }
    if (layers.has("goals") && activeTeamId) {
      jobs.push(listTeamGoals(activeTeamId).then(({ data }) => {
        (data || [])
          .filter((g) => g.week_start && g.week_start >= startStr && g.week_start < endStr)
          .forEach((g) => { const e = goalToEvent(g); if (e) collected.push(e); });
      }));
    }
    if (layers.has("availability") && avail) {
      availabilityToEvents(avail).forEach((e) => collected.push(e));
    }
    if (layers.has("actuals")) {
      (entries || [])
        .filter((e) => e.date >= startStr && e.date < endStr)
        .forEach((e) => collected.push(entryToEvent(e)));
    }

    await Promise.all(jobs);
    setEvents(collected);
  }, [activeTeamId, userId, avail, entries]);

  const reload = useCallback(() => {
    if (rangeRef.current) loadRange(rangeRef.current.start, rangeRef.current.end);
  }, [loadRange]);

  const onDatesSet = useCallback((arg) => {
    rangeRef.current = { start: arg.start, end: arg.end };
    try { localStorage.setItem(LS_VIEW, arg.view.type); } catch { /* */ }
    loadRange(arg.start, arg.end);
  }, [loadRange]);

  useEffect(() => { reload(); }, [enabledLayers, reload]);
  // When the grid is hidden (list-only), datesSet doesn't fire — seed a range.
  useEffect(() => {
    if (!rangeRef.current) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      rangeRef.current = { start, end };
      loadRange(start, end);
    }
  }, [loadRange]);

  const setMode = (id) => {
    setDisplayMode(id);
    try { localStorage.setItem(LS_DISPLAY, id); } catch { /* */ }
  };

  const toggleLayer = (layer) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer); else next.add(layer);
      try { localStorage.setItem(LS_LAYERS, JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  };

  const businessHours = useMemo(
    () => (enabledLayers.has("availability") ? businessHoursFromSettings(avail) : false),
    [enabledLayers, avail],
  );

  const onEventChange = useCallback(async (info) => {
    const p = info.event.extendedProps || {};
    const start = info.event.start;
    const end = info.event.end;
    let res = { error: null };
    if (p.type === "meeting") {
      const endISO = (end || new Date(start.getTime() + 30 * 60000)).toISOString();
      res = await updateMeetingTime(p.sourceId, start.toISOString(), endISO);
    } else if (p.type === "task") {
      res = info.event.allDay
        ? await updatePlannerSchedule(p.sourceId, { planner_date: toDateStr(start), start_time: null, duration_min: null })
        : await updatePlannerSchedule(p.sourceId, {
            planner_date: toDateStr(start),
            start_time: timeStrFromDate(start),
            duration_min: end ? Math.round((end - start) / 60000) : 60,
          });
    } else if (p.type === "task_due") {
      res = await updateTaskDue(p.sourceId, toDateStr(start));
    } else if (p.type === "ptask_due") {
      res = await updatePersonalDue(p.sourceId, toDateStr(start));
    } else if (p.type === "milestone") {
      res = await updateMilestone(p.sourceId, info.event.allDay
        ? { milestone_date: toDateStr(start), milestone_time: null }
        : { milestone_date: toDateStr(start), milestone_time: timeStrFromDate(start) });
    } else {
      info.revert();
      return;
    }
    if (res.error) info.revert();
  }, []);

  const onSelect = useCallback((arg) => {
    setNewSlot({ start: arg.start, end: arg.end, allDay: arg.allDay });
  }, []);

  // Shared activate (grid eventClick + list row click).
  const activateEvent = useCallback((p) => {
    if (!p) return;
    if (p.type === "meeting") navigate(p.roomId ? `/office/r/${p.roomId}` : "/meetings");
    else if (p.type === "task" || p.type === "task_due" || p.type === "ptask_due") navigate("/time-tracker/planner");
    else if (p.type === "goal") navigate("/team");
    else if (p.type === "milestone" && p.row) setMilestoneModal({ milestone: p.row });
  }, [navigate]);

  const createTask = async (title) => {
    if (!newSlot || !userId) return;
    const s = newSlot.start;
    const durMin = !newSlot.allDay && newSlot.end ? Math.round((newSlot.end - s) / 60000) : null;
    await createPlannerTask({
      userId, title, plannerDate: toDateStr(s),
      startTime: newSlot.allDay ? null : timeStrFromDate(s),
      durationMin: durMin,
    });
    reload();
  };

  const openAdd = () => setNewSlot({ start: new Date(), end: null, allDay: true });

  const slotLabel = newSlot
    ? (newSlot.allDay
        ? newSlot.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
        : newSlot.start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))
    : "";

  const calendar = (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      initialView={initialView}
      headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
      buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day" }}
      events={events}
      datesSet={onDatesSet}
      eventClick={(info) => activateEvent(info.event.extendedProps)}
      editable
      selectable
      selectMirror
      select={onSelect}
      eventDrop={onEventChange}
      eventResize={onEventChange}
      businessHours={businessHours}
      nowIndicator
      firstDay={1}
      slotMinTime="06:00:00"
      slotMaxTime="22:00:00"
      dayMaxEvents={3}
      height={CAL_HEIGHT}
      eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
    />
  );
  const list = <EventList events={events} dark={dark} onActivate={(e) => activateEvent(e.extendedProps)} />;

  return (
    <div className={`cal-wrap ${dark ? "cal-dark" : ""} px-2 sm:px-4 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {LAYERS.map((layer) => {
            const on = enabledLayers.has(layer);
            return (
              <button
                key={layer}
                type="button"
                onClick={() => toggleLayer(layer)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  on
                    ? dark ? "border-transparent bg-white/10 text-slate-100" : "border-transparent bg-slate-100 text-slate-800"
                    : dark ? "border-[var(--color-border)] text-slate-500" : "border-slate-200 text-slate-400"
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? LAYER_DOT[layer] : "transparent", border: on ? "none" : `1px solid ${LAYER_DOT[layer]}` }} />
                {LAYER_LABEL[layer]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className={`inline-flex rounded-lg border overflow-hidden ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
            {DISPLAY_MODES.map((m) => {
              const active = displayMode === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  title={m.label}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-[var(--color-accent)] text-white"
                      : dark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Add event</span>
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl">
        {displayMode === "list" ? (
          <div className="mx-auto w-full max-w-2xl" style={{ height: CAL_HEIGHT }}>{list}</div>
        ) : displayMode === "both" ? (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-w-0">{calendar}</div>
            <div className="lg:w-80 shrink-0" style={{ height: CAL_HEIGHT }}>{list}</div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl">{calendar}</div>
        )}
      </div>

      {newSlot && (
        <NewItemPopover
          dark={dark}
          slotLabel={slotLabel}
          onClose={() => setNewSlot(null)}
          onCreateTask={createTask}
          onPickMilestone={() => setMilestoneModal({ initialDate: toDateStr(newSlot.start) })}
          onPickMeeting={() => setMeetingModal({ initialStart: newSlot.start })}
        />
      )}
      {milestoneModal && (
        <MilestoneModal
          teamId={activeTeamId}
          dark={dark}
          initialDate={milestoneModal.initialDate}
          milestone={milestoneModal.milestone}
          onClose={() => setMilestoneModal(null)}
          onSaved={reload}
        />
      )}
      {meetingModal && (
        <ScheduleMeetingModal
          rooms={rooms}
          teamId={activeTeamId}
          dark={dark}
          initialStart={meetingModal.initialStart}
          onClose={() => setMeetingModal(null)}
          onCreated={reload}
        />
      )}
    </div>
  );
}
