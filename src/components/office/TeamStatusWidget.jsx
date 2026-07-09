import { Users } from "lucide-react";
import TeamStatusRoster from "./TeamStatusRoster";
import WidgetSection from "./WidgetSection";

// Office-sidebar widget: the whole-team status roster (grouped by room / around
// / offline). Body lives in TeamStatusRoster so the hallway can reuse it.
export default function TeamStatusWidget({ dark }) {
  return (
    <WidgetSection id="team-status" icon={Users} title="Team" dark={dark}>
      <TeamStatusRoster dark={dark} />
    </WidgetSection>
  );
}
