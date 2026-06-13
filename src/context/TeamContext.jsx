import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";
import {
  formatDuration, formatMoney, formatMonthLabel, weekStart, weekRangeLabel,
  toDisplayTime, downloadFile, unpaidBreakMins,
} from "../lib/utils";
import { listActiveTeamSessions } from "../lib/syncSession";
import { listRooms } from "../lib/rooms";
import { listOrgTeams, listMyOrgTeams, listOrgTeamMembershipsForOrg } from "../lib/orgTeam";
import { setMemberHR as setMemberHRRpc } from "../lib/hr";

const TeamContext = createContext(null);

export function TeamProvider({ session, children }) {
  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(() =>
    localStorage.getItem("ql_active_team") || null
  );
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [activeTeamSessions, setActiveTeamSessions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [orgTeams, setOrgTeams] = useState([]);
  const [myOrgTeamIds, setMyOrgTeamIds] = useState(new Set());
  const [myOrgTeamLeadIds, setMyOrgTeamLeadIds] = useState(new Set());
  // Map<userId, Array<{id, name, color, role}>>: which org_teams each
  // person belongs to. Powers <MemberIdentity /> so every sync session,
  // retro, and room card can render team chips off shared state.
  const [teamsByUserId, setTeamsByUserId] = useState(new Map());
  // Map<org_team_id, member count> — derived from the same query that
  // builds teamsByUserId, so we avoid the previous N+1 per-team fetch.
  const [orgTeamMemberCounts, setOrgTeamMemberCounts] = useState(new Map());

  const userId = session?.user?.id;
  // Read the latest activeTeamId without retriggering loadTeams.
  const activeTeamIdRef = useRef(activeTeamId);
  activeTeamIdRef.current = activeTeamId;
  // Guards a single retry when a load returns empty but localStorage hints
  // the user has teams. Reset on every non-empty (real) result.
  const emptyRetriedRef = useRef(false);

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
      .select("team_id, role, teams(id, name, invite_code, created_by, created_at, icon_url, color, office_vibe)")
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

    // Auth race-guard. On a fresh page refresh the access token sometimes
    // isn't warm yet — RLS evaluates auth.uid() to null and silently
    // returns 0 rows. If localStorage hints that we should have teams,
    // retry once instead of clobbering state. Without this the UI flips
    // to "no teams yet", drops ql_active_team, and the user has to
    // navigate away/back to recover (TOKEN_REFRESHED eventually fires in
    // the background, but only after the empty-state UI is already up).
    const current = activeTeamIdRef.current;
    if (loaded.length === 0 && current && !emptyRetriedRef.current) {
      emptyRetriedRef.current = true;
      setTimeout(() => loadTeams(), 600);
      return;
    }

    setTeams(loaded);

    if (loaded.length === 0) {
      // Either we already retried once or there was never a cached team —
      // trust the empty result.
      if (current) {
        setActiveTeamId(null);
        localStorage.removeItem("ql_active_team");
      }
      return;
    }
    emptyRetriedRef.current = false;
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
  // Uses a security-definer RPC because `user_settings` RLS only exposes
  // co-member rows to team admins. A direct join-to-user_settings returned
  // nothing for regular members, so member names + avatars never showed.
  const loadMembers = useCallback(async () => {
    if (!activeTeamId) { setTeamMembers([]); return; }
    const { data, error } = await supabase.rpc("get_team_member_profiles", {
      p_team_id: activeTeamId,
    });
    if (error) { console.warn("loadMembers:", error.message); return; }
    setTeamMembers(data || []);
  }, [activeTeamId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // Realtime: refresh the member list whenever someone joins or leaves
  // the active team. Also refresh on user_settings updates so name /
  // avatar / status changes propagate without a reload.
  // Guard against the team switching after the channel was subscribed:
  // a late event firing from the old channel would otherwise call into
  // the (newly-rebuilt) loadMembers with the *new* team, applying the
  // old team's data to the new team's UI for a tick.
  useEffect(() => {
    if (!activeTeamId) return;
    const teamIdAtSub = activeTeamId;
    const channel = supabase
      .channel(`team-members:${activeTeamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members", filter: `team_id=eq.${activeTeamId}` },
        () => {
          if (activeTeamIdRef.current !== teamIdAtSub) return;
          loadMembers();
          loadTeams();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_settings" },
        () => {
          if (activeTeamIdRef.current !== teamIdAtSub) return;
          loadMembers();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTeamId, loadMembers, loadTeams]);

  // ── Active team pomodoro sessions ──────────────────────────
  const loadActiveTeamSessions = useCallback(async () => {
    if (!activeTeamId) { setActiveTeamSessions([]); return; }
    const { data } = await listActiveTeamSessions(activeTeamId);
    setActiveTeamSessions(data || []);
  }, [activeTeamId]);

  useEffect(() => { loadActiveTeamSessions(); }, [loadActiveTeamSessions]);

  // ── Rooms ──────────────────────────────────────────────────
  const loadRoomsForActiveTeam = useCallback(async () => {
    if (!activeTeamId) { setRooms([]); return; }
    const { data } = await listRooms(activeTeamId);
    setRooms(data || []);
  }, [activeTeamId]);

  useEffect(() => { loadRoomsForActiveTeam(); }, [loadRoomsForActiveTeam]);

  // Realtime: refresh rooms when any change to this team's rooms lands.
  useEffect(() => {
    if (!activeTeamId) return;
    const teamIdAtSub = activeTeamId;
    const channel = supabase
      .channel(`team-rooms:${activeTeamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `team_id=eq.${activeTeamId}` },
        () => {
          if (activeTeamIdRef.current !== teamIdAtSub) return;
          loadRoomsForActiveTeam();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTeamId, loadRoomsForActiveTeam]);

  // ── Org teams (sub-teams within an org) ────────────────────
  // These are the real "Team" entities — SWE, PM, HR, etc. —
  // replacing the deprecated tag-on-team_member shape. Membership
  // gates room/retro access.
  const loadOrgTeamsForActive = useCallback(async () => {
    if (!activeTeamId) {
      setOrgTeams([]);
      setMyOrgTeamIds(new Set());
      setMyOrgTeamLeadIds(new Set());
      setTeamsByUserId(new Map());
      setOrgTeamMemberCounts(new Map());
      return;
    }
    const [{ data: list }, { data: mine }, { data: allMemberships }] = await Promise.all([
      listOrgTeams(activeTeamId),
      userId ? listMyOrgTeams(activeTeamId, userId) : Promise.resolve({ data: [] }),
      listOrgTeamMembershipsForOrg(activeTeamId),
    ]);
    setOrgTeams(list || []);
    setMyOrgTeamIds(new Set((mine || []).map((r) => r.org_team_id)));
    setMyOrgTeamLeadIds(new Set((mine || []).filter((r) => r.role === "lead").map((r) => r.org_team_id)));

    // Build the userId → teams map from a single allMemberships query
    // joined against the team list we just fetched.
    const teamById = new Map((list || []).map((t) => [t.id, t]));
    const next = new Map();
    const counts = new Map();
    for (const m of allMemberships || []) {
      const team = teamById.get(m.org_team_id);
      if (!team) continue; // team archived; skip
      const arr = next.get(m.user_id) || [];
      arr.push({ id: team.id, name: team.name, color: team.color, role: m.role });
      next.set(m.user_id, arr);
      counts.set(team.id, (counts.get(team.id) || 0) + 1);
    }
    setTeamsByUserId(next);
    setOrgTeamMemberCounts(counts);
  }, [activeTeamId, userId]);

  useEffect(() => { loadOrgTeamsForActive(); }, [loadOrgTeamsForActive]);

  // Realtime: pick up changes to either the team list or my memberships.
  useEffect(() => {
    if (!activeTeamId) return;
    const teamIdAtSub = activeTeamId;
    const channel = supabase
      .channel(`org-teams:${activeTeamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "org_teams", filter: `org_id=eq.${activeTeamId}` },
        () => {
          if (activeTeamIdRef.current !== teamIdAtSub) return;
          loadOrgTeamsForActive();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "org_team_members" },
        () => {
          if (activeTeamIdRef.current !== teamIdAtSub) return;
          loadOrgTeamsForActive();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTeamId, loadOrgTeamsForActive]);

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

  // Admin: update a member's HR fields (salary vs hourly, rate, target).
  async function updateMemberHR(teamId, memberId, patch) {
    const { error } = await setMemberHRRpc(teamId, memberId, patch);
    if (!error) await loadMembers();
    return { error };
  }

  // Patch team metadata (name, icon_url, color, office_vibe). Admin-only by RLS.
  async function updateTeam(teamId, patch) {
    const allowed = {};
    if (patch.name !== undefined) allowed.name = patch.name;
    if (patch.icon_url !== undefined) allowed.icon_url = patch.icon_url;
    if (patch.color !== undefined) allowed.color = patch.color;
    if (patch.office_vibe !== undefined) allowed.office_vibe = patch.office_vibe;
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
        removeMember, changeMemberRole, regenerateInviteCode, updateMemberHR,
        fetchMemberEntries, exportTeamCSV, exportTeamXLSX,
        activeTeamSessions, loadActiveTeamSessions,
        rooms, loadRoomsForActiveTeam,
        orgTeams, myOrgTeamIds, myOrgTeamLeadIds, teamsByUserId, orgTeamMemberCounts, loadOrgTeamsForActive,
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
