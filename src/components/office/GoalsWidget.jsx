import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import { useSyncSession } from "../../context/SyncSessionContext";
import GoalsList from "../GoalsList";
import WidgetSection from "./WidgetSection";

// Renders the goals a team has marked as current (see useWeekGoals),
// scoped to the room the viewer is in so room-restricted goals only show
// where they belong. Hides if none are shown.
export default function GoalsWidget({ dark, bare = false }) {
  const { syncSession } = useSyncSession();
  const { goals } = useWeekGoals(syncSession?.room_id || null);
  // As a sidebar widget it hides when empty; as a room-view tile it stays put
  // with an empty state (the tile is there because someone added it).
  if (!goals.length && !bare) return null;
  return (
    <WidgetSection id="goals" icon={Target} title="Current Goals" dark={dark} bare={bare}>
      {goals.length ? (
        <GoalsList goals={goals} dark={dark} compact />
      ) : (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>No current goals for this week.</p>
      )}
    </WidgetSection>
  );
}
