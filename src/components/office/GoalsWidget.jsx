import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import GoalsList from "../GoalsList";
import WidgetSection from "./WidgetSection";

// Renders the goals a team has marked as current (see useWeekGoals).
// Hides if none are shown — there's no useful action to take from the
// sidebar; admins choose which goals are current from the retro page,
// which this widget doesn't speak to.
export default function GoalsWidget({ dark }) {
  const { goals } = useWeekGoals();
  if (!goals.length) return null;
  return (
    <WidgetSection id="goals" icon={Target} title="Goals this week" dark={dark}>
      <GoalsList goals={goals} dark={dark} compact />
    </WidgetSection>
  );
}
