import { useEffect, useState } from "react";
import { useTeam } from "../context/TeamContext";
import { listCurrentWeekRetros } from "../lib/retro";

// Loads this week's retro goals scoped to the user's department/org
// affiliation. Org-wide retros (org_team_id null) show for everyone;
// scoped retros only show if the user is a member of that org_team.
//
// Used in three places today:
//   - /pomodoro (full page sidebar)
//   - PomodoroSurface floating modal (keeps goals visible when the
//     user opens the timer from anywhere)
//   - GoalsWidget in the office WidgetsSidebar (room view)
//
// Returns retros with non-empty `goal`. Filtering empties here keeps
// every consumer from re-deriving the same predicate.
export function useWeekGoals() {
  const { activeTeamId, myOrgTeamIds } = useTeam();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) {
        setGoals([]);
        return;
      }
      setLoading(true);
      const { data } = await listCurrentWeekRetros(activeTeamId);
      if (cancelled) return;
      const filtered = (data || [])
        .filter((r) => {
          if (r.org_team_id == null) return true;
          return myOrgTeamIds?.has(r.org_team_id);
        })
        .filter((r) => (r.goal || "").trim().length > 0);
      setGoals(filtered);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId, myOrgTeamIds]);

  return { goals, loading };
}
