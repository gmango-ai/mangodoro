import { useEffect, useState, useCallback } from "react";
import { CalendarDays } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listUpcomingMeetings } from "../../lib/scheduledMeetings";
import { useVisibilityPausedInterval } from "../../hooks/useVisibilityPausedInterval";
import UpcomingMeetingsWidget from "../office/UpcomingMeetingsWidget";
import WidgetChip from "./WidgetChip";

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Pinned-strip chip for upcoming meetings: the next meeting's start time in the
// pill, the full meetings card in the popover. Polls once a minute, paused when
// the tab is hidden so it doesn't burn cycles in the background.
export default function MeetingsChip({ dark }) {
  const { activeTeamId } = useTeam();
  const [next, setNext] = useState(null);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setNext(null); return; }
    const { data } = await listUpcomingMeetings(activeTeamId, 1);
    setNext((data || [])[0] || null);
  }, [activeTeamId]);
  useEffect(() => { reload(); }, [reload]);
  useVisibilityPausedInterval(reload, 60000, { enabled: !!activeTeamId });

  return (
    <WidgetChip
      icon={CalendarDays}
      value={next ? timeLabel(next.starts_at) : "—"}
      title={next ? `Next: ${next.title || "meeting"}` : "Upcoming meetings"}
      dark={dark}
    >
      <UpcomingMeetingsWidget dark={dark} />
    </WidgetChip>
  );
}
