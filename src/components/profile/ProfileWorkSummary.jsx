import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { getUserWorkSummary } from "../../lib/workStatus";
import { formatDuration } from "../../lib/utils";

function fmtStart(min) {
  if (min == null) return null;
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Logged-hours summary on a profile. RPC-gated to self or a team admin of the
// target (returns null otherwise → the card hides). Reads the entries log.
export default function ProfileWorkSummary({ userId, cardStyle }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [sum, setSum] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!userId) { setSum(null); return undefined; }
    getUserWorkSummary(userId).then((d) => { if (alive) setSum(d); });
    return () => { alive = false; };
  }, [userId]);

  if (!sum) return null;

  const startsAt = fmtStart(sum.avg_start_min);
  const tile = (label, value, sub) => (
    <div className={`rounded-xl px-3 py-2.5 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"}`}>
      <div className={`text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>{label}</div>
      <div className={`text-base font-bold tabular-nums ${dark ? "text-slate-100" : "text-slate-800"}`}>{value}</div>
      {sub && <div className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{sub}</div>}
    </div>
  );

  return (
    <div className="rounded-2xl border shadow-sm mt-3 p-3.5" style={cardStyle}>
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Work summary</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tile("Today", formatDuration(sum.today_minutes))}
        {tile("This week", formatDuration(sum.week_minutes), sum.days_this_week ? `${sum.days_this_week} day${sum.days_this_week === 1 ? "" : "s"} logged` : null)}
        {tile("Streak", `${sum.streak_days}`, sum.streak_days === 1 ? "day" : "days")}
        {tile("Usually starts", startsAt || "—")}
      </div>
    </div>
  );
}
