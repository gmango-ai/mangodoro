import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { listTeamGoals, listGoalRooms, listGoalKeyResults, goalProgress, weekBucket } from "../lib/goals";

// Loads the goals to surface in the office widget + pomodoro, normalized
// to one shape and scoped to the viewer:
//   * team-wide goals (owner_type company) — everyone
//   * department goals — members of that org_team
//   * personal goals (owner_type 'user') — only your own
//
// Goals come from the first-class `goals` table (written by whiteboard goal
// nodes). (Legacy retro goals were removed when retros were retired.)
//
// Each item is normalized to: { id, body, label, color, href }.
//
// `roomId` scopes surfacing: a goal restricted to specific rooms only shows
// when its room set includes `roomId`. Unrestricted goals show everywhere;
// when no room is in context (e.g. the pomodoro page), only unrestricted
// goals surface. Unpinned goals never surface.
export function useWeekGoals(roomId = null) {
  const { activeTeamId, myOrgTeamIds } = useTeam();
  const myUserId = useApp()?.session?.user?.id;
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) { setGoals([]); return; }
      setLoading(true);
      const [fcRes, roomsRes, krRes] = await Promise.all([
        listTeamGoals(activeTeamId),
        listGoalRooms(activeTeamId),
        listGoalKeyResults(activeTeamId),
      ]);
      if (cancelled) return;

      // goalId → Set(roomId) it's scoped to (absent = global).
      const scopeByGoal = new Map();
      for (const row of roomsRes?.data || []) {
        if (!scopeByGoal.has(row.goal_id)) scopeByGoal.set(row.goal_id, new Set());
        scopeByGoal.get(row.goal_id).add(row.room_id);
      }

      // goalId → key results, for a progress summary.
      const krByGoal = new Map();
      for (const kr of krRes?.data || []) {
        if (!krByGoal.has(kr.goal_id)) krByGoal.set(kr.goal_id, []);
        krByGoal.get(kr.goal_id).push(kr);
      }

      // First-class goals, scoped to the viewer + pin + room.
      const firstClass = (fcRes?.data || [])
        .filter((g) => {
          if (g.status === "done") return false; // completed goals don't surface
          if (g.pinned === false) return false; // backgrounded goals don't surface
          // Rolling week view: a goal scheduled for a SPECIFIC week only
          // surfaces during that week. 'next'/'past' weeks stay out of the
          // office until they become the current week (rolls over each Monday).
          const wb = weekBucket(g); // 'this' | 'next' | 'past' | null
          if (wb === "next" || wb === "past") return false;
          const scope = scopeByGoal.get(g.id);
          if (scope && scope.size) { if (!roomId || !scope.has(roomId)) return false; }
          if (g.owner_type === "user") return g.owner_id === myUserId;
          if (g.owner_type === "department") return !!myOrgTeamIds?.has(g.owner_id);
          return true;
        })
        .map((g) => {
          return {
            id: `goal:${g.id}`,
            body: (g.body || "").trim(),
            label: g.owner_name || (g.owner_type === "user" ? "You" : "Team"),
            color: g.owner_color || null,
            href: g.source_board ? `/whiteboards/${g.source_board}` : null,
            progress: goalProgress(krByGoal.get(g.id)).pct, // 0-100 or null
            health: g.health && g.health !== "none" ? g.health : null,
            tier: g.owner_type, // company | department | user — for ordering
            ownerId: g.owner_id, // for a stable group key (labels can collide)
            week: weekBucket(g) === "this" ? "this" : null, // dedicated "This week" section
          };
        })
        .filter((g) => g.body.length > 0);

      setGoals(firstClass);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId, myOrgTeamIds, myUserId, roomId]);

  return { goals, loading };
}
