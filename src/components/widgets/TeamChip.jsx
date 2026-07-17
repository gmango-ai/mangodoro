import { useMemo } from "react";
import { Users } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { useOfficePresence } from "../../hooks/useOfficePresence";
import TeamStatusWidget from "../office/TeamStatusWidget";
import WidgetChip from "./WidgetChip";

// Pinned-strip chip for the team: a count of teammates online now in the pill,
// the full status roster in the popover. Unlike the old "who's working" pill
// (which vanished when nobody was clocked in), this always renders — a count of
// 0 is still a valid, glanceable answer.
export default function TeamChip({ dark }) {
  const { teamMembers } = useTeam();
  const identity = useMemo(() => {
    const m = {};
    (teamMembers || []).forEach((tm) => { if (tm.user_id) m[tm.user_id] = { name: tm.name || "", avatar: tm.avatar_url || "" }; });
    return m;
  }, [teamMembers]);
  const people = useOfficePresence(identity).filter((p) => identity[p.userId]);
  const online = people.filter((p) => p.online).length;

  return (
    <WidgetChip icon={Users} value={online} label="online" title="Team — who's around" dark={dark}>
      <TeamStatusWidget dark={dark} />
    </WidgetChip>
  );
}
