import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";
import {
  formatDuration, formatMoney, formatMonthLabel, weekStart, weekRangeLabel,
  toDisplayTime, downloadFile, unpaidBreakMins,
} from "../lib/utils";
import { listActiveTeamSessions } from "../lib/syncSession";

const TeamContext = createContext(null);

export function TeamProvider({ session, children }) {
  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(() =>
    localStorage.getItem("ql_active_team") || null
  );
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [activeTeamSessions, setActiveTeamSessions] = useState([]);

  const userId = session?.user?.id;
  // Read the latest activeTeamId without retriggering loadTeams.
  const activeTeamIdRef = useRef(activeTeamId);
  activeTeamIdRef.current = activeTeamId;

  // ── Load teams ──────────────────────────────────────────────
  // Important: this callback intentionally does NOT depend on activeTeamId.
  // The previous version did, which caused the load effect to re-fire on
  // every active-team change and could race with an in-flight initial load
  // — sometimes the racing fetch returned 0 rows (auth not yet warm),
  // which cleared the user's persisted active team and left the UI empty.
  const loadTeams = useCallback(async () => {
    if (!userId) return;
    setTeamLoading(true);
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id, role, teams(id, name, invite_code, created_by, created_at, icon_url, color)")
      .eq("user_id", userId);
    setTeamLoading(false);

    // Network / auth / RLS error: bail without clobbering state. A follow-up
    // load (focus, auth refresh, manual retry) can recover.
    if (error) {
      console.warn("loadTeams:", error.message);
      return;
    }

    const loaded = (data || [])
      .map((m) => (m.teams ? { ...m.teams, role: m.role } : null))
      .filter(Boolean);
    setTeams(loaded);

    const current = activeTeamIdRef.current;
    if (loaded.length === 0) {
      // Genuinely no memberships — drop any stale local active team.
      if (current) {
        setActiveTeamId(null);
        localStorage.removeItem("ql_active_team");
      }
      return;
    }
    // Auto-select if we have none, or if the stored one is no longer valid.
    if (!current || !loaded.find((t) => t.id === current)) {
      const next = loaded[0].id;
      setActiveTeamId(next);
      localStorage.setItem("ql_active_team", next);
    }
  }, [userId]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  // Self-heal: re-fetch teams when the tab regains focus or when supabase
  // refreshes/restores the auth token. Covers the laptop-lid case where
  // the initial load fired before the access token was warm.
  useEffect(() => {
    if (!userId) return;
    function onVisible() { if (!document.hidden) loadTeams(); }
    document.addEventListener("visibilitychange", onVisible);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") loadTeams();
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      subscription.unsubscribe();
    };
  }, [userId, loadTeams]);

  // ── Load members when active team changes ──────────────────
  const loadMembers = useCallback(async () => {
    if (!activeTeamId) { setTeamMembers([]); return; }
    const { data } = await supabase
      .from("team_members")
      .select("user_id, role, joined_at")
      .eq("team_id", activeTeamId);
    if (!data) { setTeamMembers([]); return; }
    // fetch display names + avatars from user_settings
    const userIds = data.map((m) => m.user_id);
    const { data: settingsData } = await supabase
      .from("user_settings")
      .select("user_id, name, avatar_url, status, presence_state, status_updated_at")
      .in("user_id", userIds);
    const settingsMap = new Map((settingsData || []).map((s) => [s.user_id, s]));
    setTeamMembers(data.map((m) => ({
      ...m,
      name: settingsMap.get(m.user_id)?.name || "Team Member",
      avatar_url: settingsMap.get(m.user_id)?.avatar_url || "",
      status: settingsMap.get(m.user_id)?.status || "",
      presence_state: settingsMap.get(m.user_id)?.presence_state || "active",
      status_updated_at: settingsMap.get(m.user_id)?.status_updated_at || null,
    })));
  }, [activeTeamId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // ── Active team pomodoro sessions ──────────────────────────
  const loadActiveTeamSessions = useCallback(async () => {
    if (!activeTeamId) { setActiveTeamSessions([]); return; }
    const { data } = await listActiveTeamSessions(activeTeamId);
    setActiveTeamSessions(data || []);
  }, [activeTeamId]);

  useEffect(() => { loadActiveTeamSessions(); }, [loadActiveTeamSessions]);

  // Realtime: refresh when team sessions change.
  useEffect(() => {
    if (!activeTeamId) return;
    const channel = supabase
      .channel(`team-sessions:${activeTeamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_sessions", filter: `team_id=eq.${activeTeamId}` },
        loadActiveTeamSessions,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_session_participants" },
        loadActiveTeamSessions,
      )
      .subscribe();
    // Lightweight polling fallback every 30s; the timer derives from
    // ends_at so the UI stays smooth even without fresh rows.
    const pollId = setInterval(loadActiveTeamSessions, 30000);
    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [activeTeamId, loadActiveTeamSessions]);

  // ── Team CRUD ──────────────────────────────────────────────
  async function createTeam(name) {
    const { data, error } = await supabase
      .from("teams")
      .insert({ name, created_by: userId })
      .select()
      .single();
    if (error) return { error };
    // auto-add self as admin
    await supabase.from("team_members").insert({
      team_id: data.id,
      user_id: userId,
      role: "admin",
    });
    await loadTeams();
    setActiveTeamId(data.id);
    localStorage.setItem("ql_active_team", data.id);
    return { data };
  }

  async function joinTeam(inviteCode) {
    const { data, error } = await supabase.rpc("join_team_by_code", {
      code: inviteCode.trim().toLowerCase(),
    });
    if (error) return { error };
    await loadTeams();
    if (data) {
      setActiveTeamId(data);
      localStorage.setItem("ql_active_team", data);
    }
    return { data };
  }

  async function leaveTeam(teamId) {
    await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);
    await loadTeams();
  }

  function switchTeam(teamId) {
    setActiveTeamId(teamId);
    localStorage.setItem("ql_active_team", teamId || "");
  }

  // ── Admin functions ────────────────────────────────────────
  async function removeMember(teamId, memberId) {
    await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", memberId);
    await loadMembers();
  }

  async function changeMemberRole(teamId, memberId, newRole) {
    await supabase
      .from("team_members")
      .update({ role: newRole })
      .eq("team_id", teamId)
      .eq("user_id", memberId);
    await loadMembers();
  }

  // Patch team metadata (name, icon_url, color). Admin-only by RLS.
  async function updateTeam(teamId, patch) {
    const allowed = {};
    if (patch.name !== undefined) allowed.name = patch.name;
    if (patch.icon_url !== undefined) allowed.icon_url = patch.icon_url;
    if (patch.color !== undefined) allowed.color = patch.color;
    if (Object.keys(allowed).length === 0) return { data: null };
    const { data, error } = await supabase
      .from("teams")
      .update(allowed)
      .eq("id", teamId)
      .select()
      .single();
    if (!error) await loadTeams();
    return { data, error };
  }

  async function regenerateInviteCode(teamId) {
    const newCode = [...crypto.getRandomValues(new Uint8Array(6))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error } = await supabase
      .from("teams")
      .update({ invite_code: newCode })
      .eq("id", teamId);
    if (!error) await loadTeams();
    return { error };
  }

  async function deleteTeam(teamId) {
    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (!error) await loadTeams();
    return { error };
  }

  // ── Timesheet fetching ─────────────────────────────────────
  async function fetchMemberEntries(teamId, monthStr) {
    // monthStr = "YYYY-MM"
    const startDate = `${monthStr}-01`;
    const endMonth = new Date(startDate + "T12:00:00");
    endMonth.setMonth(endMonth.getMonth() + 1);
    endMonth.setDate(0); // last day of month
    const endDate = `${endMonth.getFullYear()}-${String(endMonth.getMonth() + 1).padStart(2, "0")}-${String(endMonth.getDate()).padStart(2, "0")}`;

    // get team member IDs
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId);
    if (!members?.length) return [];
    const memberIds = members.map((m) => m.user_id);

    // fetch entries
    const { data: entries } = await supabase
      .from("entries")
      .select("*")
      .in("user_id", memberIds)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

    // fetch names + avatars
    const { data: settingsData } = await supabase
      .from("user_settings")
      .select("user_id, name, avatar_url")
      .in("user_id", memberIds);
    const settingsMap = new Map((settingsData || []).map((s) => [s.user_id, s]));

    // fetch projects
    const { data: projectsData } = await supabase
      .from("projects")
      .select("id, name, user_id")
      .in("user_id", memberIds);
    const projectMap = new Map((projectsData || []).map((p) => [p.id, p]));

    // group by member
    const byMember = {};
    for (const e of (entries || [])) {
      const normalized = { ...e, start: e.start?.slice(0, 5) || "", end: e.end_time?.slice(0, 5) || "" };
      if (!byMember[e.user_id]) byMember[e.user_id] = [];
      byMember[e.user_id].push(normalized);
    }

    return memberIds.map((uid) => ({
      userId: uid,
      name: settingsMap.get(uid)?.name || "Team Member",
      avatar_url: settingsMap.get(uid)?.avatar_url || "",
      entries: byMember[uid] || [],
      projectMap,
    }));
  }

  // ── Team export: CSV ───────────────────────────────────────
  async function exportTeamCSV(teamId, monthStr) {
    const memberData = await fetchMemberEntries(teamId, monthStr);
    const team = teams.find((t) => t.id === teamId);
    const csv = (val) => { const s = String(val ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s; };
    const row = (...cells) => cells.map(csv).join(",");
    const rows = [];
    rows.push(csv(`${team?.name || "Team"} Timesheet – ${formatMonthLabel(monthStr)}`));
    rows.push("");
    rows.push(row("Member", "Date", "Start", "End", "Project", "Billable", "Unpaid Break (mins)", "Hours Worked", "Description"));
    for (const member of memberData) {
      for (const e of member.entries) {
        const bm = unpaidBreakMins(e);
        const projectName = (e.project_ids || []).map((id) => member.projectMap.get(id)?.name).filter(Boolean).join(", ");
        rows.push(row(
          member.name,
          e.date,
          toDisplayTime(e.start),
          toDisplayTime(e.end),
          projectName,
          e.billable === false ? "No" : "Yes",
          bm > 0 ? bm : "",
          formatDuration(e.minutes),
          e.description || "",
        ));
      }
    }
    downloadFile(
      new Blob([rows.join("\n")], { type: "text/csv" }),
      `${(team?.name || "team").toLowerCase().replace(/\s+/g, "_")}_${monthStr}.csv`,
    );
  }

  // ── Team export: XLSX (multi-sheet) ────────────────────────
  async function exportTeamXLSX(teamId, monthStr) {
    const memberData = await fetchMemberEntries(teamId, monthStr);
    const team = teams.find((t) => t.id === teamId);
    const { default: ExcelJS } = await import("exceljs");

    const NAVY = "FF1F3864", BLUE = "FF4472C4", WHITE = "FFFFFFFF", LIGHT = "FFF0F4FA";
    const navyFill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    const blueFill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    const lightFill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    const whiteFont = { color: { argb: WHITE }, bold: true, name: "Calibri", size: 11 };
    const boldFont = { bold: true, name: "Calibri", size: 11 };
    const baseFont = { name: "Calibri", size: 11 };
    const thinBorder = { style: "thin", color: { argb: "FFD0D7E3" } };
    const cellBorder = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    const styleAll = (r, style) => r.eachCell({ includeEmpty: true }, (cell) => Object.assign(cell, { style }));

    const wb = new ExcelJS.Workbook();

    // Summary sheet
    const summary = wb.addWorksheet("Summary");
    summary.columns = [{ width: 30 }, { width: 20 }, { width: 20 }];
    const titleRow = summary.addRow([`${team?.name || "Team"} – ${formatMonthLabel(monthStr)}`]);
    summary.mergeCells(titleRow.number, 1, titleRow.number, 3);
    titleRow.height = 24;
    titleRow.getCell(1).style = { font: { bold: true, size: 14, name: "Calibri" }, alignment: { horizontal: "center", vertical: "middle" } };
    summary.addRow([]);
    const hdr = summary.addRow(["Member", "Total Hours", "Total Entries"]);
    hdr.height = 20;
    styleAll(hdr, { fill: navyFill, font: whiteFont, border: cellBorder, alignment: { vertical: "middle" } });

    for (const member of memberData) {
      const totalMins = member.entries.reduce((a, e) => a + (e.minutes || 0), 0);
      const r = summary.addRow([member.name, formatDuration(totalMins), member.entries.length]);
      r.height = 18;
      styleAll(r, { font: baseFont, border: cellBorder, alignment: { vertical: "middle" } });
    }

    // Per-member sheets
    for (const member of memberData) {
      if (!member.entries.length) continue;
      const sheetName = (member.name || "Member").slice(0, 31);
      const ws = wb.addWorksheet(sheetName);
      const cols = [20, 12, 12, 18, 10, 22, 16, 38];
      ws.columns = cols.map((width) => ({ width }));
      const numCols = cols.length;
      const merge = (r) => ws.mergeCells(r.number, 1, r.number, numCols);

      const mTitle = ws.addRow([`${member.name} – ${formatMonthLabel(monthStr)}`]);
      merge(mTitle); mTitle.height = 24;
      mTitle.getCell(1).style = { font: { bold: true, size: 14, name: "Calibri" }, alignment: { horizontal: "center", vertical: "middle" } };
      ws.addRow([]).height = 6;

      const headerRow = ws.addRow(["Date", "Start", "End", "Project", "Billable", "Unpaid Break (mins)", "Hours Worked", "Description"]);
      headerRow.height = 20;
      styleAll(headerRow, { fill: navyFill, font: whiteFont, border: cellBorder, alignment: { vertical: "middle" } });

      // Group by week
      const wkMap = new Map();
      for (const e of member.entries) {
        const wk = weekStart(e.date);
        if (!wkMap.has(wk)) wkMap.set(wk, []);
        wkMap.get(wk).push(e);
      }

      let grandMins = 0;
      for (const [wkStr, wkEntries] of wkMap) {
        const wkLabel = weekRangeLabel(wkStr);
        const weekMins = wkEntries.reduce((a, e) => a + (e.minutes || 0), 0);
        const wkRow = ws.addRow([wkLabel, "", "", "", "", "", formatDuration(weekMins), ""]);
        wkRow.height = 22;
        styleAll(wkRow, { fill: navyFill, font: whiteFont, border: cellBorder, alignment: { vertical: "middle" } });

        // Group by day
        const byDay = new Map();
        for (const e of wkEntries) {
          if (!byDay.has(e.date)) byDay.set(e.date, []);
          byDay.get(e.date).push(e);
        }
        for (const [date, dayEntries] of byDay) {
          const dayMins = dayEntries.reduce((a, e) => a + (e.minutes || 0), 0);
          const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
          const dayRow = ws.addRow([dayLabel, "", "", "", "", "", formatDuration(dayMins), ""]);
          dayRow.height = 18;
          styleAll(dayRow, { fill: lightFill, font: boldFont, border: cellBorder, alignment: { vertical: "middle" } });
          for (const e of dayEntries) {
            const bm = unpaidBreakMins(e);
            const projectName = (e.project_ids || []).map((id) => member.projectMap.get(id)?.name).filter(Boolean).join(", ");
            const entryRow = ws.addRow([
              "", toDisplayTime(e.start), toDisplayTime(e.end), projectName,
              e.billable === false ? "No" : "Yes", bm > 0 ? bm : "",
              formatDuration(e.minutes), e.description || "",
            ]);
            entryRow.height = 16;
            styleAll(entryRow, { font: baseFont, border: cellBorder, alignment: { vertical: "middle" } });
          }
          grandMins += dayMins;
        }
        ws.addRow([]).height = 8;
      }
      const totalRow = ws.addRow(["TOTAL", "", "", "", "", "", formatDuration(grandMins), ""]);
      totalRow.height = 20;
      styleAll(totalRow, { font: boldFont, border: cellBorder, alignment: { vertical: "middle" } });
    }

    const buffer = await wb.xlsx.writeBuffer();
    downloadFile(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${(team?.name || "team").toLowerCase().replace(/\s+/g, "_")}_${monthStr}.xlsx`,
    );
  }

  // ── Active team helpers ────────────────────────────────────
  const activeTeam = teams.find((t) => t.id === activeTeamId) || null;
  const isAdmin = activeTeam?.role === "admin";

  return (
    <TeamContext.Provider
      value={{
        teams, activeTeam, activeTeamId, teamMembers, teamLoading, isAdmin,
        loadTeams, loadMembers, switchTeam,
        createTeam, joinTeam, leaveTeam, deleteTeam, updateTeam,
        removeMember, changeMemberRole, regenerateInviteCode,
        fetchMemberEntries, exportTeamCSV, exportTeamXLSX,
        activeTeamSessions, loadActiveTeamSessions,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
