import { useEffect, useState } from "react";
import { useTeam } from "../context/TeamContext";
import { listGoalsForCurrentWeek } from "../lib/retro";

// Loads the goals that apply to THIS week, scoped to the user's
// department/org affiliation. Org-wide retros (org_team_id null)
// show for everyone; scoped retros only show if the user is a
// member of that org_team.
//
// Source: each team's retro for the *previous* ISO week. Retros are
// run at the end of a week to set the next week's goal, so the
// previous week's retros hold today's focus. (Setting NEXT week's
// goal happens in THIS week's retro — a different concern, handled
// by the retro page UI itself.)
//
// Returns ALL matching retros (including empty goals) as `retros`
// so consumers can decide whether to hide or surface a placeholder.
// `goals` is the subset with non-empty goal text — convenience for
// /pomodoro which already wants only the filled set.
export function useWeekGoals() {
  const { activeTeamId, myOrgTeamIds } = useTeam();
  const [retros, setRetros] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) {
        setRetros([]);
        return;
      }
      setLoading(true);
      const { data } = await listGoalsForCurrentWeek(activeTeamId);
      if (cancelled) return;
      const filtered = (data || []).filter((r) => {
        if (r.org_team_id == null) return true;
        return myOrgTeamIds?.has(r.org_team_id);
      });
      setRetros(filtered);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId, myOrgTeamIds]);

  const goals = retros.filter((r) => (r.goal || "").trim().length > 0);
  return { retros, goals, loading };
}
