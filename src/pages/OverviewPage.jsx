import { useState, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import {
  TrendingUp,
  DollarSign,
  Clock,
  Briefcase,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  formatMoney,
  formatDuration,
  formatDecimal,
  weekStart,
  todayStr,
} from "../lib/utils";
import EarningsCard from "../components/EarningsCard";
import { Skeleton, SkeletonCard } from "../components/Skeleton";

export default function OverviewPage() {
  const {
    entries,
    hourlyRate,
    projects,
    dailyTarget,
    weeklyTarget,
    exportMonthXLSX,
    setShowInvoice,
    googleToken, googleTokenExpiry, exportToGoogleSheets, connectGoogleSheets,
    dataLoaded,
  } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;

  const monthEntries = useMemo(
    () => entries.filter((e) => e.date.startsWith(monthStr)),
    [entries, monthStr],
  );

  const totalMins = useMemo(
    () => monthEntries.reduce((a, e) => a + e.minutes, 0),
    [monthEntries],
  );
  const billableMins = useMemo(
    () =>
      monthEntries
        .filter((e) => e.billable !== false)
        .reduce((a, e) => a + e.minutes, 0),
    [monthEntries],
  );
  const totalEarnings = (billableMins / 60) * hourlyRate;

  const activeProjectIds = useMemo(() => {
    const ids = new Set(monthEntries.flatMap((e) => e.project_ids || []));
    return ids.size;
  }, [monthEntries]);

  // Daily data for the bar chart — one bar per every day of the month
  const dailyData = useMemo(() => {
    const daysInMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0,
    ).getDate();
    const map = {};
    for (let d = 1; d <= daysInMonth; d++)
      map[d] = { day: d, billable: 0, nonBillable: 0 };
    for (const e of monthEntries) {
      const day = parseInt(e.date.slice(8), 10);
      if (e.billable !== false) map[day].billable += e.minutes / 60;
      else map[day].nonBillable += e.minutes / 60;
    }
    return Object.values(map).map((d) => ({
      day: `${d.day}`,
      billable: Math.round(d.billable * 10) / 10,
      nonBillable: Math.round(d.nonBillable * 10) / 10,
    }));
  }, [monthEntries, currentMonth]);

  // Calendar day data
  const dayMap = useMemo(() => {
    const map = {};
    for (const e of monthEntries) {
      const day = parseInt(e.date.slice(8), 10);
      if (!map[day]) map[day] = { mins: 0, earnings: 0 };
      map[day].mins += e.minutes;
      if (e.billable !== false && hourlyRate > 0) {
        map[day].earnings += (e.minutes / 60) * hourlyRate;
      }
    }
    return map;
  }, [monthEntries, hourlyRate]);

  const { daysInMonth, startingDayOfWeek } = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startingDayOfWeek = new Date(year, month, 1).getDay();
    return { daysInMonth, startingDayOfWeek };
  }, [currentMonth]);

  const formatMonth = (d) =>
    d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const chartStyle = {
    backgroundColor: dark ? "#1e293b" : "#ffffff",
    border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
    borderRadius: "8px",
    color: dark ? "#ffffff" : "#1e293b",
    fontSize: "12px",
  };

  const statCardClasses = `relative rounded-xl border p-5 sm:p-6 overflow-hidden transition-all shadow-sm`;

  if (!dataLoaded) {
    return (
      <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 pb-24" aria-busy="true" aria-label="Loading overview">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-9 w-44 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} className="p-4 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-16" />
              </SkeletonCard>
            ))}
          </div>
          <SkeletonCard className="p-5">
            <Skeleton className="h-4 w-32 mb-4" />
            <Skeleton className="h-56 w-full" />
          </SkeletonCard>
          <SkeletonCard className="p-5">
            <Skeleton className="h-4 w-40 mb-4" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 pb-24">
      <div className="space-y-6 sm:space-y-8">
        <div className="flex flex-col gap-3 pb-8">
          {/* Row 1: title + month nav */}
          <div className="flex items-center justify-between gap-3">
            <h2
              className={`text-2xl font-semibold bg-gradient-to-r bg-clip-text text-transparent ${
                dark
                  ? "from-cyan-400 via-teal-400 to-emerald-400"
                  : "from-teal-600 to-emerald-600"
              }`}
            >
              Overview
            </h2>
            <div
              className={`flex items-center gap-1 rounded-xl p-1 ${dark ? "bg-slate-800/50" : "bg-slate-100"}`}
            >
              <button
                onClick={() =>
                  setCurrentMonth(
                    new Date(
                      currentMonth.getFullYear(),
                      currentMonth.getMonth() - 1,
                      1,
                    ),
                  )
                }
                className={`p-1.5 rounded-lg transition-all ${dark ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-slate-500 hover:text-slate-800 hover:bg-white shadow-sm"}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span
                className={`text-sm font-medium px-2 ${dark ? "text-slate-300" : "text-slate-600"}`}
              >
                {formatMonth(currentMonth)}
              </span>
              <button
                onClick={() =>
                  setCurrentMonth(
                    new Date(
                      currentMonth.getFullYear(),
                      currentMonth.getMonth() + 1,
                      1,
                    ),
                  )
                }
                className={`p-1.5 rounded-lg transition-all ${dark ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-slate-500 hover:text-slate-800 hover:bg-white shadow-sm"}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Row 2: export buttons — own row on mobile, tucked right on sm+ */}
          <div className="flex items-center gap-2 sm:justify-end">
            <button
              disabled={monthEntries.length === 0}
              onClick={() => {
                const byDate = monthEntries.reduce((acc, e) => {
                  (acc[e.date] = acc[e.date] || []).push(e);
                  return acc;
                }, {});
                exportMonthXLSX(monthStr, [
                  {
                    days: Object.keys(byDate)
                      .sort()
                      .map((date) => ({ date, entries: byDate[date] })),
                  },
                ]);
              }}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                dark
                  ? "border-slate-600 text-slate-200 hover:enabled:border-slate-500 hover:enabled:text-white bg-transparent"
                  : "border-slate-300 text-slate-600 hover:enabled:border-slate-400 hover:enabled:text-slate-800 bg-transparent"
              }`}
            >
              Export XLSX
            </button>
            <button
              disabled={monthEntries.length === 0}
              onClick={() => setShowInvoice(true)}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                dark
                  ? "border-slate-600 text-slate-200 hover:enabled:border-slate-500 hover:enabled:text-white bg-transparent"
                  : "border-slate-300 text-slate-600 hover:enabled:border-slate-400 hover:enabled:text-slate-800 bg-transparent"
              }`}
            >
              Invoice
            </button>
            <button
              disabled={monthEntries.length === 0}
              onClick={() => exportToGoogleSheets(monthStr, monthEntries)}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                dark
                  ? "border-slate-600 text-slate-200 hover:enabled:border-slate-500 hover:enabled:text-white bg-transparent"
                  : "border-slate-300 text-slate-600 hover:enabled:border-slate-400 hover:enabled:text-slate-800 bg-transparent"
              }`}
            >
              {googleToken && Date.now() < googleTokenExpiry ? "Export to Sheets" : "Connect Sheets"}
            </button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-8 hidden">
        {/* Earnings */}
        <div
          className={`${statCardClasses} ${
            dark
              ? "bg-slate-900/50 backdrop-blur-3xl border-emerald-500/20 hover:border-emerald-500/40"
              : "bg-white/80 backdrop-blur-xl border-emerald-200/50 hover:border-emerald-300/60"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className={`p-1.5 rounded-lg ${dark ? "bg-emerald-500/15" : "bg-emerald-50"}`}
            >
              <DollarSign
                className={`w-4 h-4 sm:w-5 sm:h-5 ${dark ? "text-emerald-400" : "text-emerald-600"}`}
              />
            </div>
            {hourlyRate > 0 && (
              <TrendingUp
                className={`w-3.5 h-3.5 flex-shrink-0 ${dark ? "text-emerald-500 text-opacity-70" : "text-emerald-500 text-opacity-70"}`}
              />
            )}
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono truncate mt-3 ${dark ? "text-white" : "text-slate-800"}`}
          >
            {hourlyRate > 0 ? formatMoney(totalEarnings) : "—"}
          </div>
          <p
            className={`text-xs mt-1 truncate ${dark ? "text-emerald-400/80" : "text-emerald-600/80"}`}
          >
            Revenue
          </p>
        </div>

        {/* Total Hours */}
        <div
          className={`${statCardClasses} ${
            dark
              ? "bg-slate-900/50 backdrop-blur-2xl border-purple-500/20 hover:border-purple-500/40"
              : "bg-white/80 backdrop-blur-xl border-purple-200/50 hover:border-purple-300/60"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className={`p-1.5 rounded-lg ${dark ? "bg-purple-500/15" : "bg-purple-50"}`}
            >
              <Clock
                className={`w-4 h-4 sm:w-5 sm:h-5 ${dark ? "text-purple-400" : "text-purple-600"}`}
              />
            </div>
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono truncate mt-3 ${dark ? "text-white" : "text-slate-800"}`}
          >
            {formatDecimal(totalMins)}
            <span
              className={`text-base font-normal ${dark ? "text-slate-500" : "text-slate-400"}`}
            >
              h
            </span>
          </div>
          <p
            className={`text-[11px] sm:text-xs mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}
          >
            Total Work
          </p>
        </div>

        {/* Hourly Rate */}
        <div
          className={`${statCardClasses} ${
            dark
              ? "bg-slate-900/50 backdrop-blur-2xl border-cyan-500/20 hover:border-cyan-500/40"
              : "bg-white/80 backdrop-blur-xl border-blue-200/50 hover:border-blue-300/60"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className={`p-1.5 rounded-lg ${dark ? "bg-cyan-500/15" : "bg-blue-50"}`}
            >
              <TrendingUp
                className={`w-4 h-4 sm:w-5 sm:h-5 ${dark ? "text-cyan-400" : "text-blue-600"}`}
              />
            </div>
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono truncate mt-3 ${dark ? "text-white" : "text-slate-800"}`}
          >
            {hourlyRate > 0 ? `$${hourlyRate}` : "—"}
          </div>
          <p
            className={`text-[11px] sm:text-xs mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}
          >
            Hourly Rate
          </p>
        </div>

        {/* Projects */}
        <div
          className={`${statCardClasses} ${
            dark
              ? "bg-slate-900/50 backdrop-blur-2xl border-pink-500/20 hover:border-pink-500/40"
              : "bg-white/80 backdrop-blur-xl border-pink-200/50 hover:border-pink-300/60"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className={`p-1.5 rounded-lg ${dark ? "bg-pink-500/15" : "bg-pink-50"}`}
            >
              <Briefcase
                className={`w-4 h-4 sm:w-5 sm:h-5 ${dark ? "text-pink-400" : "text-pink-600"}`}
              />
            </div>
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono truncate mt-3 ${dark ? "text-white" : "text-slate-800"}`}
          >
            {activeProjectIds}
          </div>
          <p
            className={`text-[11px] sm:text-xs mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}
          >
            Active Projects
          </p>
        </div>
      </div>

      {/* ── Earnings Detail + Goals ── */}
      <EarningsCard />

      {/* ── Monthly Hours Chart ── */}
      {dailyData.length > 0 && (
        <div
          className={`rounded-2xl border overflow-hidden shadow-lg mb-8 ${
            dark
              ? "bg-slate-900/50 backdrop-blur-3xl border-slate-800/50"
              : "bg-white/80 backdrop-blur-xl border-slate-200/50 shadow-slate-200/20"
          }`}
        >
          <div
            className={`px-4 sm:px-6 py-4 sm:py-5 border-b ${dark ? "border-slate-800/50" : "border-slate-100"}`}
          >
            <h3
              className={`text-sm sm:text-base font-semibold ${dark ? "text-white" : "text-slate-800"}`}
            >
              Hours by Day
            </h3>
          </div>
          <div className="p-4 sm:p-6 pb-2">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={dailyData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={
                    dark
                      ? "rgba(148, 163, 184, 0.1)"
                      : "rgba(100, 116, 139, 0.1)"
                  }
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{
                    fill: dark ? "#64748b" : "#94a3b8",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  dy={10}
                />
                <YAxis
                  tick={{
                    fill: dark ? "#64748b" : "#94a3b8",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  axisLine={false}
                  tickLine={false}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{
                    ...chartStyle,
                    borderRadius: "12px",
                    padding: "12px 16px",
                    boxShadow:
                      "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                  }}
                  itemStyle={{ paddingBottom: "4px" }}
                  labelStyle={{
                    color: dark ? "#94a3b8" : "#64748b",
                    marginBottom: "8px",
                    fontWeight: 600,
                  }}
                  formatter={(v, name) => [
                    `${v}h`,
                    name === "billable" ? "Billable" : "Non-billable",
                  ]}
                  labelFormatter={(label) =>
                    `${formatMonth(currentMonth).split(" ")[0]} ${label}`
                  }
                  cursor={{
                    fill: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: "12px",
                    color: dark ? "#94a3b8" : "#64748b",
                    paddingTop: 16,
                  }}
                  formatter={(value) => (
                    <span className="font-medium mr-4">
                      {value === "billable" ? "Billable" : "Non-billable"}
                    </span>
                  )}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar
                  dataKey="billable"
                  stackId="a"
                  fill={dark ? "#06b6d4" : "#14b8a6"}
                  radius={[0, 0, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  dataKey="nonBillable"
                  stackId="a"
                  fill={
                    dark ? "rgba(139, 92, 246, 0.6)" : "rgba(168, 85, 247, 0.6)"
                  }
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Calendar Month View ── */}
      <div
        className={`rounded-2xl border overflow-hidden shadow-lg ${
          dark
            ? "bg-slate-900/50 backdrop-blur-3xl border-slate-800/50"
            : "bg-white/80 backdrop-blur-xl border-slate-200/50 shadow-slate-200/20"
        }`}
      >
        <div className="p-4 sm:p-6 pb-6">
          {/* Calendar Header */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-blue-50"}`}
            >
              <CalendarIcon
                className={`w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 ${dark ? "text-cyan-400" : "text-blue-600"}`}
              />
            </div>
            <h3
              className={`text-base sm:text-lg font-bold ${dark ? "text-white" : "text-slate-800"}`}
            >
              {formatMonth(currentMonth)}
            </h3>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
              <div
                key={i}
                className={`text-center text-[10px] sm:text-xs font-bold uppercase tracking-wider py-1 sm:py-2 ${dark ? "text-slate-500" : "text-slate-400"}`}
              >
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: startingDayOfWeek }).map((_, i) => (
              <div
                key={`e-${i}`}
                className={`rounded-xl ${dark ? "bg-slate-800/10" : "bg-slate-50/30"}`}
              />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const data = dayMap[day];
              const hasData = !!data;
              const dateObj = new Date(
                currentMonth.getFullYear(),
                currentMonth.getMonth(),
                day,
              );
              const isWeekend = dateObj.getDay() % 6 === 0;
              const isToday =
                todayStr() === dateObj.toISOString().split("T")[0];

              return (
                <div
                  key={day}
                  className={`aspect-square sm:aspect-[4/3] rounded-xl p-1.5 sm:p-2.5 transition-all flex flex-col relative overflow-hidden group hover:-translate-y-0.5 ${
                    hasData
                      ? dark
                        ? "bg-gradient-to-br from-cyan-900/40 to-teal-900/40 border-[1.5px] border-cyan-500/30 hover:shadow-[0_8px_16px_rgba(6,182,212,0.15)]"
                        : "bg-gradient-to-br from-teal-50 to-emerald-50 border-[1.5px] border-teal-200 hover:shadow-lg hover:shadow-teal-500/10"
                      : dark
                        ? "bg-slate-800/20 border-[1.5px] border-slate-700/30 hover:border-slate-600/50"
                        : "bg-slate-50/50 border-[1.5px] border-slate-200/50 hover:border-slate-300/80"
                  } ${isWeekend && !hasData ? "opacity-40" : ""} ${isToday && !hasData ? (dark ? "!border-cyan-500/50" : "!border-teal-400/50") : ""}`}
                >
                  {isToday && (
                    <div
                      className={`absolute top-0 right-0 w-8 h-8 -mr-4 -mt-4 rotate-45 ${dark ? "bg-cyan-500/30" : "bg-teal-400/30"}`}
                    />
                  )}

                  <div
                    className={`text-xs sm:text-sm font-bold leading-none ${
                      hasData
                        ? dark
                          ? "text-cyan-300"
                          : "text-teal-700"
                        : isToday
                          ? dark
                            ? "text-cyan-400"
                            : "text-teal-600"
                          : dark
                            ? "text-slate-500"
                            : "text-slate-400"
                    }`}
                  >
                    {day}
                  </div>
                  {hasData && (
                    <div className="mt-auto">
                      <div
                        className={`font-mono font-bold leading-tight ${dark ? "text-cyan-100" : "text-teal-900"}`}
                        style={{ fontSize: "clamp(10px, 2.5vw, 12px)" }}
                      >
                        {formatDuration(data.mins)}
                      </div>
                      {hourlyRate > 0 && (
                        <div
                          className={`hidden sm:block text-[10px] sm:text-xs font-medium truncate mt-0.5 ${dark ? "text-cyan-500/70" : "text-teal-600/70"}`}
                        >
                          {formatMoney(data.earnings)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div
            className={`mt-6 pt-4 border-t flex items-center justify-center gap-6 ${dark ? "border-slate-800/50" : "border-slate-200/50"}`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-md border-[1.5px] ${dark ? "bg-cyan-900/40 border-cyan-500/40" : "bg-teal-100 border-teal-300"}`}
              />
              <span
                className={`text-xs font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}
              >
                Logged Day
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-md border-[1.5px] ${dark ? "bg-slate-800/30 border-slate-700/50" : "bg-slate-50/50 border-slate-200/50"}`}
              />
              <span
                className={`text-xs font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}
              >
                No Work
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
