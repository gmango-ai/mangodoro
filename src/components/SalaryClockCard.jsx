import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Play, Square, Target } from "lucide-react";
import { fetchMyWeekMinutes } from "../lib/hr";

// Simple clock-in card for salary employees. No project picker, no
// rounding rules — just "did I work today / how am I doing against my
// weekly target." Hourly users keep the precise time tracker.
//
// Reuses the existing active_clock infrastructure (handleClockIn /
// handleClockOut) so a clock here is the same kind of session as one
// from /time-tracker — just with simpler chrome.
export default function SalaryClockCard() {
  const { session, clockIn, clockedTick, todayMins, handleClockIn, handleClockOut } = useApp();
  const { teamMembers } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [weekMins, setWeekMins] = useState(null);

  const me = teamMembers.find((m) => m.user_id === session?.user?.id) || null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await fetchMyWeekMinutes();
      if (cancelled || error) return;
      setWeekMins(data ?? 0);
    }
    load();
    return () => { cancelled = true; };
    // clockedTick bumps every 30s, so the week total refreshes
    // periodically without needing a separate ticker.
  }, [clockedTick, clockIn]);

  // Live session elapsed.
  const activeMs = clockIn?.start ? Date.now() - new Date(clockIn.start).getTime() : 0;
  const activeMins = Math.max(0, Math.floor(activeMs / 60000));
  const todayTotalMins = (todayMins || 0) + (clockIn?.start ? activeMins : 0);
  const weekTotalMins = (weekMins || 0) + (clockIn?.start ? activeMins : 0);
  const targetHours = me?.weekly_target_hours || 40;
  const targetMins = targetHours * 60;
  const progressPct = Math.min(100, Math.round((weekTotalMins / Math.max(1, targetMins)) * 100));

  function fmtHm(mins) {
    if (!mins || mins < 0) return "0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  const isClocked = !!clockIn?.start;

  const cardCls = `rounded-2xl border p-5 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200 shadow-sm"
  }`;

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Quick clock
          </p>
          <h2 className={`text-base font-bold mt-0.5 ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {isClocked ? "On the clock" : "Off the clock"}
          </h2>
          {isClocked && (
            <p className="text-xs mt-0.5 text-[var(--color-accent)] font-mono">
              {fmtHm(activeMins)} this session
            </p>
          )}
        </div>
        {isClocked ? (
          <Button
            onClick={handleClockOut}
            variant="outline"
            className={dark ? "text-amber-300 border-amber-500/40 hover:bg-amber-500/10" : "text-amber-700 border-amber-300 hover:bg-amber-50"}
          >
            <Square className="w-4 h-4 mr-1.5" /> Clock out
          </Button>
        ) : (
          <Button onClick={() => handleClockIn()}>
            <Play className="w-4 h-4 mr-1.5" /> Clock in
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-lg px-3 py-2 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Today
          </p>
          <p className={`text-lg font-bold font-mono ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {fmtHm(todayTotalMins)}
          </p>
        </div>
        <div className={`rounded-lg px-3 py-2 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            This week
          </p>
          <p className={`text-lg font-bold font-mono ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {fmtHm(weekTotalMins)}
          </p>
        </div>
      </div>

      {/* Weekly progress */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className={`text-[11px] font-semibold flex items-center gap-1 ${
            dark ? "text-slate-400" : "text-slate-500"
          }`}>
            <Target className="w-3 h-3" /> Target {targetHours}h / week
          </p>
          <span className={`text-[11px] font-mono ${
            progressPct >= 100
              ? dark ? "text-emerald-300" : "text-emerald-600"
              : dark ? "text-slate-300" : "text-slate-700"
          }`}>
            {progressPct}%
          </span>
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"}`}>
          <div
            className={`h-full rounded-full transition-all ${
              progressPct >= 100
                ? dark ? "bg-emerald-400" : "bg-emerald-500"
                : "bg-[var(--color-accent)]"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
