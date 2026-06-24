import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { listShownGoals } from "../lib/retro";
import { listTeamGoals } from "../lib/goals";

// Loads the goals to surface in the office widget + pomodoro, normalized
// to one shape and scoped to the viewer:
//   * team-wide retro goals (org_team_id null) — everyone
//   * department goals (retro or first-class) — members of that org_team
//   * personal goals (first-class owner_type 'user') — only your own
//
// Two sources are merged: first-class goals (the `goals` table, written
// by whiteboard goal nodes) and legacy retro goals (retros.goal flagged
// shown). A first-class department goal supersedes the legacy retro goal
// for the same department.
//
// Each item is normalized to: { id, body, label, color, href }.
export function useWeekGoals() {
  const { activeTeamId, myOrgTeamIds } = useTeam();
  const myUserId = useApp()?.session?.user?.id;
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) { setGoals([]); return; }
      setLoading(true);
      const [retroRes, fcRes] = await Promise.all([
        listShownGoals(activeTeamId),
        listTeamGoals(activeTeamId),
      ]);
      if (cancelled) return;

      // First-class goals, scoped to the viewer.
      const fcDeptIds = new Set();
      const firstClass = (fcRes?.data || [])
        .filter((g) => {
          if (g.status === "done") return false; // completed goals don't surface
          if (g.owner_type === "user") return g.owner_id === myUserId;
          if (g.owner_type === "department") return !!myOrgTeamIds?.has(g.owner_id);
          return true;
        })
        .map((g) => {
          if (g.owner_type === "department") fcDeptIds.add(g.owner_id);
          return {
            id: `goal:${g.id}`,
            body: (g.body || "").trim(),
            label: g.owner_name || (g.owner_type === "user" ? "You" : "Team"),
            color: g.owner_color || null,
            href: g.source_board ? `/whiteboards/${g.source_board}` : null,
          };
        })
        .filter((g) => g.body.length > 0);

      // Legacy retro goals, scoped + deduped against first-class depts.
      const legacy = (retroRes?.data || [])
        .filter((r) => {
          if (r.org_team_id == null) return true;
          if (!myOrgTeamIds?.has(r.org_team_id)) return false;
          return !fcDeptIds.has(r.org_team_id); // first-class supersedes
        })
        .map((r) => ({
          id: `retro:${r.id}`,
          body: (r.goal || "").trim(),
          label: r.org_team_name || r.department || "Team",
          color: null,
          href: `/retros/${r.id}`,
        }))
        .filter((r) => r.body.length > 0);

      setGoals([...firstClass, ...legacy]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId, myOrgTeamIds, myUserId]);

  return { goals, loading };
}
