import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { listTeamGoals } from "../lib/goals";
import {
  LAYERS, LAYER_LABEL,
  toDateStr,
  fetchMeetingsInRange, fetchPlannerTasksInRange, fetchMyAvailability,
  meetingToEvent, plannerTaskToEvent, goalToEvent, availabilityToEvents,
  businessHoursFromSettings,
} from "../lib/calendar";
import "../components/calendar/calendar.css";

const LS_LAYERS = "cal_layers";
const LS_VIEW = "cal_view";

const LAYER_DOT = {
  meetings: "#14b8a6",
  tasks: "#6366f1",
  goals: "#f59e0b",
  availability: "#64748b",
};

function loadEnabledLayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LAYERS));
    if (Array.isArray(raw)) return new Set(raw.filter((l) => LAYERS.includes(l)));
  } catch { /* */ }
  return new Set(LAYERS);
}

export default function CalendarPage() {
  const { session } = useApp();
  const { activeTeamId } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const userId = session?.user?.id;

  const [enabledLayers, setEnabledLayers] = useState(loadEnabledLayers);
  const [events, setEvents] = useState([]);
  const [avail, setAvail] = useState(null);
  const initialView = (() => {
    try { return localStorage.getItem(LS_VIEW) || "dayGridMonth"; } catch { return "dayGridMonth"; }
  })();

  const rangeRef = useRef(null); // { start: Date, end: Date }
  const layersRef = useRef(enabledLayers);
  layersRef.current = enabledLayers;

  // Own work-hours / OOO (fetched once).
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

    await Promise.all(jobs);
    setEvents(collected);
  }, [activeTeamId, userId, avail]);

  const onDatesSet = useCallback((arg) => {
    rangeRef.current = { start: arg.start, end: arg.end };
    try { localStorage.setItem(LS_VIEW, arg.view.type); } catch { /* */ }
    loadRange(arg.start, arg.end);
  }, [loadRange]);

  // Reload when layers or availability change (using the current visible range).
  useEffect(() => {
    if (rangeRef.current) loadRange(rangeRef.current.start, rangeRef.current.end);
  }, [enabledLayers, avail, loadRange]);

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

  const onEventClick = useCallback((info) => {
    const p = info.event.extendedProps || {};
    if (p.type === "meeting") navigate(p.roomId ? `/office/r/${p.roomId}` : "/meetings");
    else if (p.type === "task") navigate("/time-tracker/planner");
    else if (p.type === "goal") navigate("/team");
  }, [navigate]);

  return (
    <div className={`cal-wrap ${dark ? "cal-dark" : ""} px-2 sm:px-4 py-3`}>
      {/* Layer filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
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

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView={initialView}
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
        buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", list: "Agenda" }}
        events={events}
        datesSet={onDatesSet}
        eventClick={onEventClick}
        businessHours={businessHours}
        nowIndicator
        firstDay={1}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        dayMaxEvents={3}
        height="auto"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
      />
    </div>
  );
}
