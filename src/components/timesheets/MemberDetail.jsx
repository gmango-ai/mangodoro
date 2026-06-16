import { useEffect, useMemo, useState } from "react";
import { Search, X, FileSpreadsheet } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import UserAvatar from "../UserAvatar";
import WeeklyHeatmap from "./WeeklyHeatmap";
import {
  formatDuration, toDisplayTime, unpaidBreakMins, weekRangeLabel, weekStart,
} from "../../lib/utils";

function totalMinutes(member) {
  return (member.entries || []).reduce((a, e) => a + (e.minutes || 0), 0);
}

// Detail pane for a selected member's month.
//
// Layout:
//   ┌─────────────────────────────────────────────────────┐
//   │ [Avatar 56px]  Name                  [heatmap]      │  hero
//   │                142h 12m · 47 entries · June          │
//   ├─────────────────────────────────────────────────────┤
//   │ [Project ▾]  [🔍 Search entries…]   ·  filter chip  │  filter bar
//   ├─────────────────────────────────────────────────────┤
//   │ WEEK OF JUN 9  ──────────────────────────  18h 30m  │
//   │ Mon Jun 9   ─────────────────────────────   3h 45m  │  day separator
//   │ ▌ 9:00–11:30  [Mango]    Refactoring…       2h 30m  │  entry rows
//   │ ▌ 1:00–2:15   [ClickUp]  Reviewing PR       1h 15m  │
//   │ Tue Jun 10  ─────────────────────────────   6h 12m  │
//   │ ...                                                  │
//   └─────────────────────────────────────────────────────┘
//
// The previous version wrapped every day in its own bordered card,
// which made any reasonably-active month look like a stack of receipts.
// This is one continuous list with quiet HR-style day separators so
// the eye scrolls naturally across the month.
//
// Each entry row uses the project's color as a 3px left border, giving
// the list an instant "what kind of work" scan without needing to read
// every project chip.

const ENTRY_GRID = "grid grid-cols-[110px_140px_minmax(0,1fr)_72px_72px] gap-3 items-center";
const ENTRY_GRID_DAY = "grid grid-cols-[110px_140px_minmax(0,1fr)_72px_72px] gap-3 items-center";

export default function MemberDetail({ member, monthStr, monthLabel }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [projectFilter, setProjectFilter] = useState("all");
  const [textSearch, setTextSearch] = useState("");

  // Reset filters when the member changes.
  useEffect(() => {
    setProjectFilter("all");
    setTextSearch("");
  }, [member?.userId]);

  // Projects this member used in the month (sorted by name).
  const memberProjects = useMemo(() => {
    if (!member) return [];
    const map = member.projectMap || new Map();
    const list = [...map.values()].filter((p) => p.user_id === member.userId);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [member]);

  const filteredEntries = useMemo(() => {
    if (!member) return [];
    let rows = member.entries || [];
    if (projectFilter !== "all") {
      rows = rows.filter((e) => (e.project_ids || []).includes(projectFilter));
    }
    const q = textSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) => (e.description || "").toLowerCase().includes(q));
    }
    return rows;
  }, [member, projectFilter, textSearch]);

  // Group filtered entries by week → day.
  const weekGroups = useMemo(() => {
    const weekMap = new Map();
    for (const e of filteredEntries) {
      const wk = weekStart(e.date);
      if (!weekMap.has(wk)) weekMap.set(wk, new Map());
      const dayMap = weekMap.get(wk);
      if (!dayMap.has(e.date)) dayMap.set(e.date, []);
      dayMap.get(e.date).push(e);
    }
    return [...weekMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([wk, dayMap]) => ({
        weekStart: wk,
        days: [...dayMap.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([d, rows]) => ({ date: d, entries: rows })),
      }));
  }, [filteredEntries]);

  if (!member) {
    return (
      <div className={`flex-1 flex items-center justify-center p-10 ${
        dark ? "text-slate-500" : "text-slate-400"
      }`}>
        <p className="text-sm">Select a member to see their timesheet.</p>
      </div>
    );
  }

  const mins = totalMinutes(member);
  const filteredMins = filteredEntries.reduce((a, e) => a + (e.minutes || 0), 0);
  const filteredActive = projectFilter !== "all" || textSearch.trim().length > 0;
  const filterChipLabel = projectFilter !== "all"
    ? memberProjects.find((p) => p.id === projectFilter)?.name
    : null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Hero header: identity + totals + side heatmap */}
      <header className={`px-6 py-5 border-b ${
        dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-start gap-5 flex-wrap">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <UserAvatar url={member.avatar_url} name={member.name} size={56} className="shrink-0" />
            <div className="min-w-0">
              <h2 className={`text-2xl font-bold truncate ${
                dark ? "text-slate-100" : "text-slate-800"
              }`}>
                {member.name}
              </h2>
              <p className={`text-3xl font-mono font-bold tabular-nums mt-1 leading-none ${
                mins > 0 ? "text-[var(--color-accent)]" : dark ? "text-slate-500" : "text-slate-400"
              }`}>
                {formatDuration(mins)}
              </p>
              <p className={`text-[11px] mt-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {member.entries.length} {member.entries.length === 1 ? "entry" : "entries"}
                <span className="opacity-60"> · </span>
                {monthLabel}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <WeeklyHeatmap entries={member.entries} monthStr={monthStr} />
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className={`px-6 py-3 border-b flex items-center gap-2 flex-wrap ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      }`}>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={`text-xs rounded-md border px-2 py-1.5 ${
            dark
              ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-200"
              : "bg-white border-slate-200 text-slate-700"
          }`}
        >
          <option value="all">All projects</option>
          {memberProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`} />
          <input
            type="text"
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
            placeholder="Search entries…"
            className={`w-full pl-8 pr-7 py-1.5 rounded-md border text-xs ${
              dark
                ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
                : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
            }`}
          />
          {textSearch && (
            <button
              type="button"
              onClick={() => setTextSearch("")}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded ${
                dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
              }`}
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {filteredActive && (
          <span className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {filterChipLabel && <span className="opacity-60">{filterChipLabel} · </span>}
            <span className="font-semibold text-[var(--color-accent)] font-mono">
              {formatDuration(filteredMins)}
            </span>
            <span className="opacity-60"> in </span>
            {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {/* Flat entry list */}
      <div className="flex-1 px-6 py-3">
        {weekGroups.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-16 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            <FileSpreadsheet className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">
              {member.entries.length === 0
                ? "No entries for this month."
                : "No entries match your filters."}
            </p>
          </div>
        ) : weekGroups.map(({ weekStart: wk, days }) => {
          const weekMins = days.reduce(
            (a, d) => a + d.entries.reduce((b, e) => b + (e.minutes || 0), 0),
            0
          );
          return (
            <section key={wk} className="mb-6">
              {/* Week header — uppercase label, accent left bar, total on right */}
              <div className="flex items-center gap-3 mb-3">
                <span className="w-0.5 h-3.5 bg-[var(--color-accent)] rounded-full" aria-hidden />
                <h3 className={`text-[10px] font-bold uppercase tracking-widest ${
                  dark ? "text-slate-300" : "text-slate-700"
                }`}>
                  {weekRangeLabel(wk)}
                </h3>
                <span className={`flex-1 h-px ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
                <span className="text-[11px] font-mono font-semibold text-[var(--color-accent)]">
                  {formatDuration(weekMins)}
                </span>
              </div>

              {/* Days */}
              <div className="space-y-3">
                {days.map(({ date, entries: rows }) => {
                  const dayMins = rows.reduce((a, e) => a + (e.minutes || 0), 0);
                  const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "short", month: "short", day: "numeric",
                  });
                  return (
                    <div key={date}>
                      {/* Day separator — quiet HR with label + total */}
                      <div className={`${ENTRY_GRID_DAY} mb-1.5 text-[11px]`}>
                        <span className={`font-semibold ${dark ? "text-slate-300" : "text-slate-600"}`}>
                          {dayLabel}
                        </span>
                        <span />
                        <span className={`h-px ${dark ? "bg-[var(--color-border)]/60" : "bg-slate-200/80"}`} />
                        <span />
                        <span className={`text-right font-mono ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {formatDuration(dayMins)}
                        </span>
                      </div>

                      {/* Entry rows */}
                      <ul className="space-y-1">
                        {rows.map((e) => {
                          const bm = unpaidBreakMins(e);
                          const projects = (e.project_ids || [])
                            .map((id) => member.projectMap.get(id))
                            .filter(Boolean);
                          const primaryProject = projects[0];
                          const accent = primaryProject?.color || (dark ? "#475569" : "#cbd5e1");
                          return (
                            <li
                              key={e.id}
                              className={`${ENTRY_GRID} text-xs rounded-md py-1.5 pr-3 transition-colors hover:bg-[var(--color-accent-light)]/40`}
                              style={{ borderLeft: `3px solid ${accent}`, paddingLeft: "12px" }}
                            >
                              <span className={`tabular-nums font-mono ${
                                dark ? "text-slate-400" : "text-slate-500"
                              }`}>
                                {toDisplayTime(e.start)}–{toDisplayTime(e.end)}
                              </span>
                              <span className="truncate">
                                {projects.length > 0 ? (
                                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                                    dark ? "text-slate-300" : "text-slate-700"
                                  }`}>
                                    {projects.map((p, i) => (
                                      <span key={p.id}>
                                        {i > 0 && <span className="opacity-50 mx-0.5">·</span>}
                                        {p.name}
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  <span className={`text-[11px] italic ${
                                    dark ? "text-slate-500" : "text-slate-400"
                                  }`}>
                                    no project
                                  </span>
                                )}
                              </span>
                              <span className={`truncate ${dark ? "text-slate-300" : "text-slate-700"}`}>
                                {e.description || (
                                  <span className={`italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                    no description
                                  </span>
                                )}
                              </span>
                              <span className={`text-right text-[10px] ${
                                bm > 0
                                  ? dark ? "text-slate-500" : "text-slate-400"
                                  : "text-transparent"
                              }`}>
                                {bm > 0 ? `−${bm}m` : "·"}
                              </span>
                              <span className="tabular-nums font-mono font-semibold text-right text-[var(--color-accent)]">
                                {formatDuration(e.minutes)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
