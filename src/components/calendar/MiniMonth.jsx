import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toDateStr } from "../../lib/calendar";

// Compact month picker for the calendar left rail. `selected` (Date) highlights
// the focused day; onPick(date) jumps the main calendar there. `weekStart` is
// 0 (Sunday) or 1 (Monday).
const DOW = ["S", "M", "T", "W", "T", "F", "S"]; // indexed by JS day-of-week

export default function MiniMonth({ selected, weekStart = 1, onPick }) {
  const [cursor, setCursor] = useState(() => new Date((selected || new Date()).getFullYear(), (selected || new Date()).getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const dowOrder = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const startPad = (first.getDay() - weekStart + 7) % 7;
  const gridStart = new Date(year, month, 1 - startPad);

  const todayStr = toDateStr(new Date());
  const selStr = selected ? toDateStr(selected) : null;

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push(d);
  }

  return (
    <div className="cal-ocean__mini">
      <div className="cal-ocean__mini-hd">
        <span className="m">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <span style={{ display: "flex", gap: 2 }}>
          <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></button>
        </span>
      </div>
      <div className="cal-ocean__mini-grid">
        {dowOrder.map((d, i) => <span key={i} className="dow">{DOW[d]}</span>)}
        {cells.map((d) => {
          const s = toDateStr(d);
          const cls = ["d"];
          if (d.getMonth() !== month) cls.push("out");
          if (s === todayStr) cls.push("today");
          else if (s === selStr) cls.push("sel");
          return (
            <button key={s} type="button" className={cls.join(" ")} onClick={() => onPick(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
