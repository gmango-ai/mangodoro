import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, ArrowLeft, Download, FileSpreadsheet,
  FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  formatMonthLabel, formatDuration, toDisplayTime, unpaidBreakMins, weekStart, weekRangeLabel,
} from "../lib/utils";

export default function TeamTimesheetsPage() {
  const { activeTeam, activeTeamId, isAdmin, fetchMemberEntries, exportTeamCSV, exportTeamXLSX } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;

  const [memberData, setMemberData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [filterMember, setFilterMember] = useState("all");

  useEffect(() => {
    if (!activeTeamId || !isAdmin) return;
    setLoading(true);
    fetchMemberEntries(activeTeamId, monthStr).then((data) => {
      setMemberData(data);
      setLoading(false);
      // Auto-expand all members
      setExpandedMembers(new Set(data.map((m) => m.userId)));
    });
  }, [activeTeamId, monthStr, isAdmin]);

  function prevMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function toggleMember(uid) {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  function toggleWeek(key) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const filteredMembers = useMemo(() => {
    if (filterMember === "all") return memberData;
    return memberData.filter((m) => m.userId === filterMember);
  }, [memberData, filterMember]);

  const totalTeamMins = useMemo(
    () => memberData.reduce((a, m) => a + m.entries.reduce((b, e) => b + (e.minutes || 0), 0), 0),
    [memberData],
  );

  if (!isAdmin) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[720px] mx-auto">
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Only team admins can view timesheets.</p>
      </main>
    );
  }

  const cardCls = `rounded-xl border p-5 ${
    dark ? "bg-slate-900/60 border-slate-700/50 shadow-lg shadow-black/20" : "bg-white border-slate-200 shadow-sm"
  }`;
  const labelCls = `text-xs font-medium uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`;

  return (
    <main className="px-4 pt-6 pb-24 max-w-[900px] mx-auto space-y-5">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/team")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Team Timesheets</h1>
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>{activeTeam?.name}</p>
        </div>
      </div>

      {/* Month Nav + Export */}
      <div className={`${cardCls} flex items-center justify-between flex-wrap gap-3`}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className={`text-sm font-semibold min-w-[140px] text-center ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {formatMonthLabel(monthStr)}
          </span>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* Member filter */}
          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            className={`text-xs rounded-lg border px-2 py-1.5 ${
              dark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-slate-200 text-slate-600"
            }`}
          >
            <option value="all">All Members</option>
            {memberData.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => exportTeamCSV(activeTeamId, monthStr)}>
            <FileText className="w-3.5 h-3.5 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportTeamXLSX(activeTeamId, monthStr)}>
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className={`${cardCls} flex items-center justify-between`}>
        <div>
          <p className={labelCls}>Total Team Hours</p>
          <p className={`text-2xl font-bold mt-1 ${dark ? "text-cyan-400" : "text-teal-600"}`}>
            {formatDuration(totalTeamMins)}
          </p>
        </div>
        <div>
          <p className={labelCls}>Members</p>
          <p className={`text-2xl font-bold mt-1 ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {memberData.length}
          </p>
        </div>
        <div>
          <p className={labelCls}>Entries</p>
          <p className={`text-2xl font-bold mt-1 ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {memberData.reduce((a, m) => a + m.entries.length, 0)}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className={`text-center py-8 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Loading timesheets…
        </div>
      )}

      {/* Member Timesheets */}
      {!loading && filteredMembers.map((member) => {
        const memberMins = member.entries.reduce((a, e) => a + (e.minutes || 0), 0);
        const isExpanded = expandedMembers.has(member.userId);

        // Group entries by week
        const weekMap = new Map();
        for (const e of member.entries) {
          const wk = weekStart(e.date);
          if (!weekMap.has(wk)) weekMap.set(wk, []);
          weekMap.get(wk).push(e);
        }

        return (
          <div key={member.userId} className={cardCls}>
            {/* Member header */}
            <button
              onClick={() => toggleMember(member.userId)}
              className="w-full flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  dark ? "bg-cyan-500/20 text-cyan-400" : "bg-teal-100 text-teal-700"
                }`}>
                  {(member.name || "?")[0].toUpperCase()}
                </div>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{member.name}</p>
                  <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {member.entries.length} entries
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline">{formatDuration(memberMins)}</Badge>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {/* Expanded: week/day breakdown */}
            {isExpanded && (
              <div className="mt-4 space-y-3">
                {[...weekMap.entries()].map(([wkStr, wkEntries]) => {
                  const weekMins = wkEntries.reduce((a, e) => a + (e.minutes || 0), 0);
                  const wkKey = `${member.userId}-${wkStr}`;
                  const wkOpen = expandedWeeks.has(wkKey);

                  // Group by day
                  const byDay = new Map();
                  for (const e of wkEntries) {
                    if (!byDay.has(e.date)) byDay.set(e.date, []);
                    byDay.get(e.date).push(e);
                  }

                  return (
                    <div key={wkStr}>
                      <button
                        onClick={() => toggleWeek(wkKey)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer ${
                          dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <span>{weekRangeLabel(wkStr)}</span>
                        <span>{formatDuration(weekMins)}</span>
                      </button>

                      {wkOpen && (
                        <div className="ml-2 mt-1 space-y-1">
                          {[...byDay.entries()].map(([date, dayEntries]) => {
                            const dayMins = dayEntries.reduce((a, e) => a + (e.minutes || 0), 0);
                            const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                              weekday: "short", month: "short", day: "numeric",
                            });
                            return (
                              <div key={date}>
                                <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-medium ${
                                  dark ? "text-slate-400" : "text-slate-500"
                                }`}>
                                  <span>{dayLabel}</span>
                                  <span>{formatDuration(dayMins)}</span>
                                </div>
                                {dayEntries.map((e) => {
                                  const bm = unpaidBreakMins(e);
                                  const projectName = (e.project_ids || [])
                                    .map((id) => member.projectMap.get(id)?.name)
                                    .filter(Boolean)
                                    .join(", ");
                                  return (
                                    <div
                                      key={e.id}
                                      className={`flex items-center gap-3 px-3 py-1.5 ml-3 text-xs rounded ${
                                        dark ? "text-slate-400" : "text-slate-500"
                                      }`}
                                    >
                                      <span className="tabular-nums whitespace-nowrap">
                                        {toDisplayTime(e.start)} – {toDisplayTime(e.end)}
                                      </span>
                                      {projectName && (
                                        <Badge variant="outline" className="text-[10px] py-0">{projectName}</Badge>
                                      )}
                                      <span className="flex-1 truncate">{e.description || ""}</span>
                                      <span className="tabular-nums whitespace-nowrap font-medium">
                                        {formatDuration(e.minutes)}
                                      </span>
                                      {bm > 0 && (
                                        <span className="text-[10px] opacity-60">-{bm}m break</span>
                                      )}
                                    </div>
                                  );
                                })}
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

      {/* Empty state */}
      {!loading && filteredMembers.length === 0 && (
        <div className={`${cardCls} text-center py-12`}>
          <FileSpreadsheet className={`w-12 h-12 mx-auto mb-3 ${dark ? "text-slate-600" : "text-slate-300"}`} />
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            No timesheet entries for {formatMonthLabel(monthStr)}.
          </p>
        </div>
      )}
    </main>
  );
}
