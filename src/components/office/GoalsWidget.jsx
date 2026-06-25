import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import { useSyncSession } from "../../context/SyncSessionContext";
import GoalsList from "../GoalsList";
import WidgetSection from "./WidgetSection";

// Renders the goals a team has marked as current (see useWeekGoals),
// scoped to the room the viewer is in so room-restricted goals only show
// where they belong. Hides if none are shown.
export default function GoalsWidget({ dark }) {
  const { syncSession } = useSyncSession();
  const { goals } = useWeekGoals(syncSession?.room_id || null);
  if (!goals.length) return null;
  return (
    <WidgetSection id="goals" icon={Target} title="Current Goals" dark={dark}>
      <GoalsList goals={goals} dark={dark} compact />
    </WidgetSection>
  );
}
