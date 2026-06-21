import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, ArrowLeft, FileSpreadsheet, FileText, Menu,
} from "lucide-react";
import MembersList from "../components/timesheets/MembersList";
import MemberDetail from "../components/timesheets/MemberDetail";
import { formatMonthLabel, formatDuration } from "../lib/utils";

// Master–detail admin timesheets:
//   ┌────────────┬─────────────────────────────┐
//   │ Members    │ Member detail               │
//   │  list      │  ├─ header                  │
//   │  + search  │  ├─ weekly heatmap          │
//   │  + sort    │  ├─ project + text filters  │
//   │            │  └─ week/day entry list     │
//   └────────────┴─────────────────────────────┘
// Replaces the previous stacked-cards layout, which became unusable
// once any one teammate had more than ~30 entries in a month.
//
// Mobile collapses the sidebar into a drawer that slides in from the
// left (same pattern as the office shell).
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
  const monthLabel = formatMonthLabel(monthStr);

  const [memberData, setMemberData] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [sortBy, setSortBy] = useState("hours");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!activeTeamId || !isAdmin) return;
    setLoading(true);
    fetchMemberEntries(activeTeamId, monthStr).then((data) => {
      setMemberData(data);
      setLoading(false);
    });
  }, [activeTeamId, monthStr, isAdmin, fetchMemberEntries]);

  function totalMinutes(m) {
    return (m.entries || []).reduce((a, e) => a + (e.minutes || 0), 0);
  }

  const filteredMembers = useMemo(() => {
    let list = memberData;
    const q = memberSearch.trim().toLowerCase();
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q));
    if (sortBy === "hours") {
      list = [...list].sort((a, b) => totalMinutes(b) - totalMinutes(a));
    } else if (sortBy === "entries") {
      list = [...list].sort((a, b) => b.entries.length - a.entries.length);
    } else if (sortBy === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [memberData, memberSearch, sortBy]);

  // Auto-select the first sorted member (or keep the existing
  // selection if it's still in the filtered list).
  useEffect(() => {
    if (!filteredMembers.length) {
      if (selectedMemberId) setSelectedMemberId(null);
      return;
    }
    if (!filteredMembers.some((m) => m.userId === selectedMemberId)) {
      setSelectedMemberId(filteredMembers[0].userId);
    }
  }, [filteredMembers, selectedMemberId]);

  const selectedMember = memberData.find((m) => m.userId === selectedMemberId) || null;

  const totalTeamMins = useMemo(
    () => memberData.reduce((a, m) => a + totalMinutes(m), 0),
    [memberData]
  );
  const totalEntries = useMemo(
    () => memberData.reduce((a, m) => a + m.entries.length, 0),
    [memberData]
  );

  if (!isAdmin) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[720px] mx-auto">
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Only team admins can view timesheets.
        </p>
      </main>
    );
  }

  function prevMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function handleSelectMember(id) {
    setSelectedMemberId(id);
    setDrawerOpen(false);
  }

  const sidebar = (
    <MembersList
      members={filteredMembers}
      selectedId={selectedMemberId}
      onSelect={handleSelectMember}
      monthStr={monthStr}
      searchValue={memberSearch}
      onSearchChange={setMemberSearch}
      sortBy={sortBy}
      onSortChange={setSortBy}
    />
  );

  return (
    // Fill below the global nav: subtract the nav bar (3.5rem mobile / 4rem
    // desktop) + the top safe-area inset. Flat `100vh - 64px` was too tall on
    // mobile / Dynamic Island phones.
    <main className="flex flex-col h-[calc(100dvh-3.5rem-var(--top-inset)-var(--bottom-inset))] sm:h-[calc(100dvh-4rem-var(--top-inset)-var(--bottom-inset))]">
      {/* Top bar — one line: title left, month nav + icon-only exports right */}
      <div className={`px-4 sm:px-6 py-2.5 border-b ${
        dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/team")} className="h-8 w-8 -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="mr-auto min-w-0">
            <h1 className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Team Timesheets
              <span className={`ml-2 font-normal ${dark ? "text-slate-500" : "text-slate-400"}`}>
                · {activeTeam?.name}
              </span>
            </h1>
            <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              <span className="font-semibold text-[var(--color-accent)] font-mono">
                {formatDuration(totalTeamMins)}
              </span>
              <span className="opacity-70"> across </span>
              <span className={`font-semibold ${dark ? "text-slate-300" : "text-slate-600"}`}>
                {memberData.length}
              </span>
              <span className="opacity-70"> {memberData.length === 1 ? "member" : "members"} · </span>
              <span className={`font-semibold ${dark ? "text-slate-300" : "text-slate-600"}`}>
                {totalEntries}
              </span>
              <span className="opacity-70"> {totalEntries === 1 ? "entry" : "entries"}</span>
            </p>
          </div>

          {/* Mobile sidebar toggle */}
          <Button variant="outline" size="icon" className="md:hidden h-8 w-8" onClick={() => setDrawerOpen(true)}>
            <Menu className="w-4 h-4" />
          </Button>

          {/* Month nav */}
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Previous month" className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className={`text-xs font-semibold min-w-[100px] text-center ${
              dark ? "text-slate-200" : "text-slate-700"
            }`}>
              {monthLabel}
            </span>
            <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Next month" className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Export — icon-only with tooltip */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              title="Download CSV"
              onClick={() => exportTeamCSV(activeTeamId, monthStr)}
              className="h-8 w-8"
            >
              <FileText className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Download Excel"
              onClick={() => exportTeamXLSX(activeTeamId, monthStr)}
              className="h-8 w-8"
            >
              <FileSpreadsheet className="w-4 h-4" />
            </Button>
          </div>
        </div>

      </div>

      {/* Body: master-detail */}
      <div className="flex-1 min-h-0 flex">
        {/* Desktop sidebar */}
        <div className="hidden md:flex w-80 shrink-0 h-full">
          {sidebar}
        </div>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-[150] bg-black/50"
            onClick={() => setDrawerOpen(false)}
          >
            <div
              className="absolute inset-y-0 left-0 w-80 max-w-[85vw] h-full"
              onClick={(e) => e.stopPropagation()}
            >
              {sidebar}
            </div>
          </div>
        )}

        {/* Detail */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className={`flex items-center justify-center h-full p-10 text-sm ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              Loading timesheets…
            </div>
          ) : memberData.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-full p-10 ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              <FileSpreadsheet className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">No timesheet entries for {monthLabel}.</p>
            </div>
          ) : (
            <MemberDetail
              member={selectedMember}
              monthStr={monthStr}
              monthLabel={monthLabel}
            />
          )}
        </div>
      </div>
    </main>
  );
}
