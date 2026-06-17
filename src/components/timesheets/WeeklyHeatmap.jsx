import { useTheme } from "../../context/ThemeContext";
import { formatDuration } from "../../lib/utils";

// Month-view heatmap: rows = calendar weeks (Sun-Sat), columns =
// days of the week. Each cell's intensity scales to the member's
// own peak day, so 8-hour days "fill" the cell regardless of whether
// they're outliers vs typical for that person.
//
// Hover shows a precise tooltip via the cell's `title`. Cells from
// outside the month render as muted background so the rows always
// align to a Sun-Sat grid.
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function WeeklyHeatmap({ entries, monthStr }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [yearStr, monStr] = monthStr.split("-");
  const year = Number(yearStr);
  const month = Number(monStr); // 1-12
  const daysInMonth = new Date(year, month, 0).getDate();

  // Day -> minutes lookup (1-indexed day of month).
  const dayTotals = {};
  for (const e of entries || []) {
    if (!e.date) continue;
    const d = Number(e.date.split("-")[2]);
    if (d >= 1 && d <= daysInMonth) {
      dayTotals[d] = (dayTotals[d] || 0) + (e.minutes || 0);
    }
  }
  const maxMins = Math.max(1, ...Object.values(dayTotals));

  // Build the calendar grid. Each row is a Sun-Sat week. First row
  // starts on the Sunday of the week that contains day 1 of the month.
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sun
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to full last week.
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // Fixed cell height keeps the heatmap glance-able — without this,
  // aspect-square cells balloon when the pane is wide and the
  // calendar dominates the view above the entry list. Container is
  // also capped so it sits as a compact card.
  const cellBaseCls = "h-6 rounded text-[9px] inline-flex items-end justify-end px-1 transition-colors";
  const emptyCellCls = dark ? "bg-[var(--color-surface-raised)]/40" : "bg-slate-100";
  const noWorkCellCls = dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50 border border-slate-100";

  return (
    <div className="max-w-[320px]">
      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            className={`text-[10px] text-center font-semibold uppercase tracking-wider ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}
          >
            {d}
          </div>
        ))}
      </div>
      {/* Week rows */}
      <div className="space-y-1">
        {rows.map((week, ri) => (
          <div key={ri} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              if (day == null) {
                return <div key={di} className={`${cellBaseCls} ${emptyCellCls}`} aria-hidden />;
              }
              const mins = dayTotals[day] || 0;
              const intensity = mins > 0 ? Math.max(0.18, mins / maxMins) : 0;
              const dateLabel = new Date(year, month - 1, day).toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric",
              });
              return (
                <div
                  key={di}
                  title={`${dateLabel} · ${mins > 0 ? formatDuration(mins) : "no entries"}`}
                  className={`${cellBaseCls} ${mins > 0 ? "" : noWorkCellCls}`}
                  style={mins > 0 ? { background: `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, transparent)` } : {}}
                >
                  <span className={`tabular-nums font-semibold ${
                    mins > 0
                      ? (dark || intensity > 0.55 ? "text-white" : "text-[var(--color-accent)]")
                      : dark ? "text-slate-600" : "text-slate-400"
                  }`}>
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
