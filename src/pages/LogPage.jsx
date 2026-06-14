import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import LogHoursForm from "../components/LogHoursForm";
import EntryRow from "../components/EntryRow";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMonthLabel, formatDuration, formatMoney, weekRangeLabel, unpaidBreakMins } from "../lib/utils";

function timeToHour(t) {
  if (!t) return 8;
  const [h, m] = t.split(":").map(Number);
  return h + m / 60;
}

export default function LogPage() {
  const {
    entries, grouped, projects, sortAsc, setSortAsc,
    expandedDates, toggleExpanded, inlineEditId, cancelInlineEdit,
    showSettings, hourlyRate, deepseekKey, monthSummaries, setMonthSummaries,
    generateMonthSummary, exportMonthXLSX, exportToGoogleSheets, googleToken, googleTokenExpiry, flash,
    localImportBanner, setLocalImportBanner, importFromLocalStorage,
    importEntriesRef, importProfileRef, importEntriesFromFile, importProfileFromFile,
    dataLoaded,
  } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [expandedMonths, setExpandedMonths] = useState(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const initializedRef = useRef(false);

  // Auto-expand the most recent month and week on first load
  useEffect(() => {
    if (!initializedRef.current && grouped.length > 0) {
      initializedRef.current = true;
      setExpandedMonths(new Set([grouped[0].monthKey]));
      if (grouped[0].weeks.length > 0) {
        setExpandedWeeks(new Set([grouped[0].weeks[0].weekKey]));
      }
    }
  }, [grouped]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape" && inlineEditId) { cancelInlineEdit(); return; }
      if (editing || showSettings) return;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineEditId, showSettings, cancelInlineEdit]);

  function toggleMonth(key) {
    setExpandedMonths((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function toggleWeek(key) {
    setExpandedWeeks((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 pb-24">

      {/* LocalStorage migration banner */}
      {localImportBanner && (
        <div style={{ background: "var(--color-warn-bg)", border: "1px solid var(--color-warn-border)", borderRadius: 10, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-warn-text)", margin: 0 }}>Local data found</p>
            <p style={{ fontSize: 12, color: "var(--color-warn-muted)", marginTop: 2 }}>
              {localImportBanner.count} {localImportBanner.count === 1 ? "entry" : "entries"} saved in this browser before you created an account.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setLocalImportBanner(null)} style={{ fontSize: 12, color: "var(--color-warn-text)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", opacity: 0.7 }}>Dismiss</button>
            <button onClick={importFromLocalStorage} style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#d97706", border: "none", borderRadius: 6, cursor: "pointer", padding: "6px 14px" }}>Import to account</button>
          </div>
        </div>
      )}

      {/* Log Hours form */}
      <LogHoursForm />

      {/* Sort control */}
      {grouped.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "0 2px" }}>
          <p style={{ fontSize: 12, color: "var(--color-muted)" }}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</p>
          <button
            onClick={() => setSortAsc((s) => !s)}
            className={`flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              dark
                ? "border-slate-600 text-slate-200 hover:border-slate-500 hover:text-white bg-transparent"
                : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900 bg-transparent"
            }`}
          >
            {sortAsc ? "↑ Oldest first" : "↓ Newest first"}
          </button>
        </div>
      )}

      {/* Skeleton while first load is in flight — don't show "No entries
          yet" until we're sure the user really has none. */}
      {!dataLoaded ? (
        <LogPageSkeleton />
      ) : grouped.length === 0 ? (
        <div style={{ textAlign: "center", paddingTop: 64, paddingBottom: 64 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗓</div>
          <p style={{ fontSize: 14, color: "var(--color-muted)" }}>No entries yet. Start logging your hours above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ monthKey, weeks }) => {
            const monthMins = weeks.flatMap((w) => w.days).flatMap((d) => d.entries).reduce((a, e) => a + e.minutes, 0);
            const isMonthExpanded = expandedMonths.has(monthKey);

            return (
              <div key={monthKey} className="space-y-3">
                {/* Month Header */}
                <div className={`p-4 sm:p-5 rounded-xl transition-all ${
                  dark
                    ? "bg-[var(--color-bg)] backdrop-blur-xl border border-slate-800/50 hover:border-[var(--color-accent)]"
                    : "bg-white/40 backdrop-blur-xl border border-slate-200/60 hover:border-blue-300/60"
                }`}>
                  {/* Row 1: toggle + name + duration */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => toggleMonth(monthKey)}
                      className="flex items-center gap-3 text-left flex-1 min-w-0"
                    >
                      {isMonthExpanded
                        ? <ChevronDown className="w-5 h-5 flex-shrink-0 text-[var(--color-accent)]" />
                        : <ChevronRight className={`w-5 h-5 flex-shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                      }
                      <div>
                        <h3 className={`text-lg sm:text-xl font-semibold ${dark ? "text-white" : "text-slate-800"}`}>
                          {formatMonthLabel(monthKey)}
                        </h3>
                        <p className={`text-xs sm:text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {weeks.length} {weeks.length === 1 ? "week" : "weeks"}
                        </p>
                      </div>
                    </button>
                    <div className="text-xl font-mono font-semibold flex-shrink-0 text-[var(--color-accent)]">
                      {formatDuration(monthMins)}
                    </div>
                  </div>
                  {/* Row 2: earnings + actions — always visible */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800/30 flex-wrap">
                    {hourlyRate > 0 && (
                      <span className={`text-sm font-semibold font-mono mr-auto ${dark ? "text-slate-300" : "text-slate-600"}`}>
                        {formatMoney((monthMins / 60) * hourlyRate)}
                      </span>
                    )}
                    {deepseekKey && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => generateMonthSummary(monthKey, weeks)}
                        disabled={monthSummaries[monthKey]?.loading}
                        className={`h-7 text-xs border ${dark ? "border-slate-600 text-slate-200 hover:text-white hover:border-slate-400 bg-transparent" : "border-slate-300 text-slate-600 hover:text-slate-800 bg-transparent"}`}
                      >
                        {monthSummaries[monthKey]?.loading ? "Summarising…" : "✦ Summarise"}
                      </Button>
                    )}
                    <Button
                      size="sm" variant="outline"
                      onClick={() => exportMonthXLSX(monthKey, weeks)}
                      className={`h-7 text-xs border ${dark ? "border-slate-600 text-slate-200 hover:text-white hover:border-slate-400 bg-transparent" : "border-slate-300 text-slate-600 hover:text-slate-800 bg-transparent"}`}
                    >
                      Export XLSX
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => exportToGoogleSheets(monthKey, weeks.flatMap((w) => w.days.flatMap((d) => d.entries)))}
                      className={`h-7 text-xs border ${dark ? "border-slate-600 text-slate-200 hover:text-white hover:border-slate-400 bg-transparent" : "border-slate-300 text-slate-600 hover:text-slate-800 bg-transparent"}`}
                    >
                      {googleToken && Date.now() < googleTokenExpiry ? "Sheets" : "Connect Sheets"}
                    </Button>
                  </div>
                </div>

                {/* AI summary */}
                {monthSummaries[monthKey]?.text && (
                  <div style={{ background: "var(--color-accent-light)", border: "1px solid var(--color-accent-border)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1, color: "var(--color-accent)" }}>✦</span>
                    <p style={{ fontSize: 13, color: "var(--color-accent-text)", lineHeight: 1.6, margin: 0, flex: 1 }}>{monthSummaries[monthKey].text}</p>
                    <button onClick={() => { navigator.clipboard.writeText(monthSummaries[monthKey].text); flash("✓ Copied"); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent-border)", fontSize: 12, flexShrink: 0, padding: "2px 4px" }}>Copy</button>
                    <button onClick={() => setMonthSummaries((s) => { const n = { ...s }; delete n[monthKey]; return n; })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent-border)", fontSize: 14, flexShrink: 0, lineHeight: 1 }}>✕</button>
                  </div>
                )}

                {/* Weeks */}
                {isMonthExpanded && (
                  <div className="ml-2 sm:ml-4 space-y-3">
                    {weeks.map(({ weekKey, days }) => {
                      const weekMins = days.flatMap((d) => d.entries).reduce((a, e) => a + e.minutes, 0);
                      const isWeekExpanded = expandedWeeks.has(weekKey);

                      return (
                        <div key={weekKey} className="space-y-2">
                          {/* Week Header */}
                          <button
                            onClick={() => toggleWeek(weekKey)}
                            className={`w-full flex items-center justify-between p-4 rounded-lg transition-all ${
                              dark
                                ? "bg-[var(--color-surface-raised)] border border-[var(--color-border-light)] hover:border-slate-600/50"
                                : "bg-slate-50/50 border border-slate-200/50 hover:border-slate-300/60"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {isWeekExpanded
                                ? <ChevronDown className="w-4 h-4 text-[var(--color-accent)]" />
                                : <ChevronRight className={`w-4 h-4 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                              }
                              <span className={`text-sm font-semibold ${dark ? "text-slate-300" : "text-slate-700"}`}>
                                {weekRangeLabel(weekKey)}
                              </span>
                            </div>
                            <div className="text-lg font-mono font-semibold text-[var(--color-accent)]">
                              {formatDuration(weekMins)}
                            </div>
                          </button>

                          {/* Days */}
                          {isWeekExpanded && (
                            <div className="ml-2 sm:ml-4 space-y-3">
                              {days.map(({ date, entries: dayEntries }) => {
                                const dayTotal = dayEntries.reduce((a, e) => a + e.minutes, 0);
                                const dateObj = new Date(date + "T12:00:00");
                                const dayName = dateObj.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
                                const dayNum = dateObj.getDate();
                                const monthName = dateObj.toLocaleDateString("en-US", { month: "short" });
                                const isExpanded = expandedDates.has(date);

                                return (
                                  <div
                                    key={date}
                                    className={`rounded-xl border overflow-hidden transition-all ${
                                      dark
                                        ? "bg-[var(--color-bg)] backdrop-blur-xl border-slate-800/50"
                                        : "bg-white/50 backdrop-blur-xl border-slate-200/50"
                                    }`}
                                  >
                                    {/* Day Header */}
                                    <div
                                      onClick={() => toggleExpanded(date, dayEntries)}
                                      className={`px-5 py-4 cursor-pointer select-none ${
                                        isExpanded ? `border-b ${dark ? "border-slate-800/50" : "border-slate-200/50"}` : ""
                                      } ${dark ? "bg-slate-800/20" : "bg-slate-50/50"}`}
                                    >
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                          {/* Date block */}
                                          <div className="text-center flex-shrink-0 w-10">
                                            <div className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>{dayName}</div>
                                            <div className={`text-2xl font-bold leading-tight ${dark ? "text-white" : "text-slate-800"}`}>{dayNum}</div>
                                            <div className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>{monthName}</div>
                                          </div>
                                          {/* Timeline */}
                                          <div className="flex-1 min-w-0">
                                            <div className={`flex justify-between text-xs mb-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                              <span>8 AM</span><span>12 PM</span><span>4 PM</span><span>8 PM</span>
                                            </div>
                                            <div className={`h-3 rounded-full relative overflow-hidden ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-200/50"}`}>
                                              {dayEntries.map((entry, i) => {
                                                const startH = timeToHour(entry.start);
                                                const endH = timeToHour(entry.end);
                                                const leftPct = Math.max(0, Math.min(100, ((startH - 8) / 12) * 100));
                                                const widthPct = Math.max(0, Math.min(100 - leftPct, ((endH - startH) / 12) * 100));
                                                const firstProject = projects.find((p) => (entry.project_ids || [])[0] === p.id);
                                                const barColor = firstProject
                                                  ? firstProject.color + (entry.billable !== false ? "cc" : "66")
                                                  : entry.billable !== false
                                                    ? "color-mix(in srgb, var(--color-accent) 80%, transparent)"
                                                    : "color-mix(in srgb, var(--color-accent) 35%, transparent)";
                                                return (
                                                  <div
                                                    key={i}
                                                    className="absolute top-0 h-full"
                                                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: barColor }}
                                                  />
                                                );
                                              })}
                                              {dayEntries.flatMap((entry, i) => {
                                                const firstProject = projects.find((p) => (entry.project_ids || [])[0] === p.id);
                                                const breakColor = firstProject
                                                  ? firstProject.color + "44"
                                                  : "color-mix(in srgb, var(--color-accent) 25%, transparent)";
                                                return (entry.breaks || []).filter((b) => b.unpaid).map((b, j) => {
                                                  const bLeft = Math.max(0, ((timeToHour(b.start) - 8) / 12) * 100);
                                                  const bWidth = Math.max(0, ((timeToHour(b.end) - timeToHour(b.start)) / 12) * 100);
                                                  return (
                                                    <div key={`${i}-${j}`}
                                                      className="absolute top-0 h-full"
                                                      style={{ left: `${bLeft}%`, width: `${bWidth}%`, background: breakColor }}
                                                    />
                                                  );
                                                });
                                              })}
                                            </div>
                                            {/* Breakdown summary */}
                                            {(() => {
                                              const billMins = dayEntries.filter((e) => e.billable !== false).reduce((a, e) => a + e.minutes, 0);
                                              const nonBillMins = dayEntries.filter((e) => e.billable === false).reduce((a, e) => a + e.minutes, 0);
                                              const brkMins = dayEntries.reduce((a, e) => a + unpaidBreakMins(e), 0);
                                              return (
                                                <div className="flex items-center gap-3 mt-1.5">
                                                  {billMins > 0 && (
                                                    <span className="flex items-center gap-1">
                                                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[var(--color-accent)]" />
                                                      <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{formatDuration(billMins)}</span>
                                                    </span>
                                                  )}
                                                  {nonBillMins > 0 && (
                                                    <span className="flex items-center gap-1">
                                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dark ? "bg-slate-700" : "bg-slate-300"}`} />
                                                      <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{formatDuration(nonBillMins)}</span>
                                                    </span>
                                                  )}
                                                  {brkMins > 0 && (
                                                    <span className="flex items-center gap-1">
                                                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[var(--color-accent-light-hover)]" />
                                                      <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{brkMins}m break</span>
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        </div>
                                        {/* Right: totals */}
                                        <div className="sm:text-right flex-shrink-0 ml-0 sm:ml-4 flex items-center justify-between sm:block border-t sm:border-t-0 pt-3 sm:pt-0 mt-2 sm:mt-0 border-slate-200 dark:border-[var(--color-border-light)]">
                                          {hourlyRate > 0 && (
                                            <div className={`text-xs font-mono mb-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                                              {formatMoney((dayTotal / 60) * hourlyRate)}
                                            </div>
                                          )}
                                          <div className="text-xl font-mono font-semibold text-[var(--color-accent)]">
                                            {formatDuration(dayTotal)}
                                          </div>
                                          <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                            {dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}
                                          </p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Entries */}
                                    {isExpanded && (
                                      <div className="p-4 space-y-3">
                                        {dayEntries.map((entry, i) => (
                                          <EntryRow key={entry.id} entry={entry} index={i} />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={importEntriesRef} type="file" accept=".json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importEntriesFromFile(f); e.target.value = ""; }} />
      <input ref={importProfileRef} type="file" accept=".json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importProfileFromFile(f); e.target.value = ""; }} />
    </div>
  );
}

function LogPageSkeleton() {
  return (
    <div className="space-y-4 mt-4" aria-busy="true" aria-label="Loading entries">
      {[0, 1].map((m) => (
        <SkeletonCard key={m} className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Skeleton className="w-5 h-5 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/20 flex items-center gap-2 flex-wrap">
            <Skeleton className="h-3 w-20" />
            <div className="ml-auto flex gap-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-20 rounded-md" />
            </div>
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}
