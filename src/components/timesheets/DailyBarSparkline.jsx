import { useTheme } from "../../context/ThemeContext";

// Compact bar chart showing one column per day of the month. Used in
// the members sidebar to give an at-a-glance read on how a person's
// hours distribute across the month. Tiny on purpose — 80px × 20px by
// default.
//
// `entries` is the full list of entries for the month. `monthStr`
// ("YYYY-MM") tells us how many days the month has.
export default function DailyBarSparkline({ entries, monthStr, width = 80, height = 20 }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [yearStr, monStr] = monthStr.split("-");
  const year = Number(yearStr);
  const month = Number(monStr); // 1-12
  const daysInMonth = new Date(year, month, 0).getDate();

  // Bucket minutes per day.
  const dayTotals = new Array(daysInMonth).fill(0);
  for (const e of entries || []) {
    if (!e.date) continue;
    const d = Number(e.date.split("-")[2]);
    if (d >= 1 && d <= daysInMonth) {
      dayTotals[d - 1] += e.minutes || 0;
    }
  }

  const max = Math.max(1, ...dayTotals);
  const gap = 1;
  const barWidth = Math.max(1, (width - gap * (daysInMonth - 1)) / daysInMonth);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="shrink-0"
    >
      {dayTotals.map((mins, i) => {
        const h = Math.max(1, (mins / max) * height);
        const x = i * (barWidth + gap);
        const y = height - h;
        const filled = mins > 0;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={0.5}
            className={filled
              ? "fill-[var(--color-accent)]"
              : dark ? "fill-slate-700" : "fill-slate-200"}
          />
        );
      })}
    </svg>
  );
}
