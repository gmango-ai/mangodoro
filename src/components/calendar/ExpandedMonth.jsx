import { ChevronDown, ChevronRight } from "lucide-react";
import { oceanType } from "./oceanTheme";
import { toDateStr } from "../../lib/calendar";

// An "expanded" alternative to the month grid: a scrollable list of days, each
// day's events/tasks grouped into collapsible sections by type — so you can read
// every task without opening the "+more" popover.

const TYPE_ORDER = [
  "worklocation", "worklocation_app", "worklocation_conflict", "ooo", "goal",
  "meeting", "task_due", "ptask_due", "milestone", "google", "task", "actual",
];
const TYPE_LABEL = {
  worklocation: "Location", worklocation_app: "Location", worklocation_conflict: "Location conflict",
  ooo: "Out of office", goal: "Goals", meeting: "Meetings", task_due: "Deadlines", ptask_due: "Deadlines",
  milestone: "Milestones", google: "Google", task: "Tasks", actual: "Time tracked",
};
const strip = (s) => String(s || "").replace(/^[⏳◆🏖⏱🎯]\s*/, "");

export default function ExpandedMonth({ events, collapsedTypes, onToggleType, onOpen }) {
  const items = (events || [])
    .filter((e) => e.display !== "background" && !["ooo_bg", "workhours"].includes(e.extendedProps?.type))
    .map((e) => ({ ...e, _s: new Date(e.start) }))
    .filter((e) => !Number.isNaN(e._s.getTime()))
    .sort((a, b) => a._s - b._s || (a.extendedProps?.orderRank ?? 2) - (b.extendedProps?.orderRank ?? 2));

  const days = [];
  let cur = null;
  for (const it of items) {
    const k = toDateStr(it._s);
    if (k !== cur) { days.push({ key: k, date: new Date(it._s), byType: new Map() }); cur = k; }
    const d = days[days.length - 1];
    const t = it.extendedProps?.type || "other";
    if (!d.byType.has(t)) d.byType.set(t, []);
    d.byType.get(t).push(it);
  }

  if (days.length === 0) return <p className="cal-ocean__empty" style={{ padding: 20 }}>No events in this range.</p>;

  return (
    <div className="cal-exp">
      {days.map((day) => (
        <div key={day.key} className="cal-exp__day">
          <div className="cal-exp__dayhd">{day.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          {TYPE_ORDER.filter((t) => day.byType.has(t)).map((t) => {
            const list = day.byType.get(t);
            const meta = oceanType(t);
            const collapsed = collapsedTypes.has(t);
            return (
              <div key={t} className="cal-exp__grp">
                <button type="button" className="cal-exp__grphd" onClick={() => onToggleType(t)}>
                  {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span className="dot" style={{ background: meta.solid }} />
                  <span className="lbl">{TYPE_LABEL[t] || t}</span>
                  <span className="cnt">{list.length}</span>
                </button>
                {!collapsed && list.map((it) => (
                  <button key={it.id} type="button" className="cal-exp__item" onClick={() => onOpen(it)}>
                    {!it.allDay ? <span className="time">{it._s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span> : <span className="time" style={{ fontStyle: "italic", opacity: 0.6 }}>all-day</span>}
                    <span className="txt" style={{ textDecoration: it.extendedProps?.done ? "line-through" : "none" }}>{strip(it.title)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
