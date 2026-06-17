import { useEffect, useState } from "react";
import { useTeam } from "../context/TeamContext";
import { listCurrentWeekRetros } from "../lib/retro";

// Loads this week's retros scoped to the user's department/org
// affiliation. Org-wide retros (org_team_id null) show for everyone;
// scoped retros only show if the user is a member of that org_team.
//
// Used in three places today:
//   - /pomodoro (full page sidebar)
//   - PomodoroSurface floating modal (keeps goals visible when the
//     user opens the timer from anywhere)
//   - GoalsWidget in the office WidgetsSidebar (room view)
//
// Returns ALL matching retros — including ones with an empty `goal`
// — so consumers can render a "Set this week's goal" CTA instead of
// silently hiding when nobody's filled one in yet. Consumers that
// only care about set goals can filter on `goals` (vs `retros`).
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
      const { data } = await listCurrentWeekRetros(activeTeamId);
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

  // Back-compat: `goals` is the subset with a non-empty goal. Callers
  // that want to show the "no goal set" CTA should iterate `retros`.
  const goals = retros.filter((r) => (r.goal || "").trim().length > 0);
  return { retros, goals, loading };
}
