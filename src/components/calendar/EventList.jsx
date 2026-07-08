import { useMemo } from "react";
import { toDateStr } from "../../lib/calendar";

// Agenda-style list of the currently-loaded calendar events (excludes the
// background availability shading). Shared click handling with the grid.

function eventColor(e) {
  if (e.backgroundColor && e.backgroundColor !== "transparent") return e.backgroundColor;
  return e.borderColor || "#94a3b8";
}
function fmtDayHeading(d) {
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (toDateStr(d) === toDateStr(now)) return "Today";
  if (toDateStr(d) === toDateStr(tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function EventList({ events, dark, onActivate }) {
  const groups = useMemo(() => {
    const items = (events || [])
      .filter((e) => e.display !== "background" && e.extendedProps?.type !== "ooo")
      .map((e) => ({ ...e, _start: new Date(e.start) }))
      .filter((e) => !Number.isNaN(e._start.getTime()))
      .sort((a, b) => a._start - b._start);
    const out = [];
    let key = null;
    for (const e of items) {
      const k = toDateStr(e._start);
      if (k !== key) { out.push({ key: k, date: e._start, items: [] }); key = k; }
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events]);

  return (
    <div className={`rounded-xl border h-full overflow-y-auto ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
      {groups.length === 0 ? (
        <p className={`text-sm p-4 ${dark ? "text-slate-500" : "text-slate-400"}`}>Nothing in view.</p>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className={`sticky top-0 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur ${dark ? "bg-[var(--color-surface)]/90 text-slate-400" : "bg-white/90 text-slate-500"}`}>
              {fmtDayHeading(g.date)}
            </div>
            <ul>
              {g.items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onActivate(e)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: eventColor(e) }} />
                    <span className={`flex-1 min-w-0 truncate ${dark ? "text-slate-200" : "text-slate-700"}`}>{e.title}</span>
                    {!e.allDay && (
                      <span className={`shrink-0 text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{fmtTime(e._start)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
