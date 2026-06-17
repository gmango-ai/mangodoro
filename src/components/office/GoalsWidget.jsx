import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import GoalsList from "../GoalsList";
import WidgetSection from "./WidgetSection";

// Renders the goals from LAST week's retros (which define THIS week's
// focus). Hides if nobody set a goal — there's no useful action to
// take from the sidebar; users set next week's goal directly in
// today's retro, which this widget doesn't speak to.
export default function GoalsWidget({ dark }) {
  const { goals } = useWeekGoals();
  if (!goals.length) return null;
  return (
    <WidgetSection id="goals" icon={Target} title="Goals this week" dark={dark}>
      <GoalsList goals={goals} dark={dark} compact />
    </WidgetSection>
  );
}
