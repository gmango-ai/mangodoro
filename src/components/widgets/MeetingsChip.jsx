import { useEffect, useState, useCallback } from "react";
import { CalendarDays } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listUpcomingMeetings } from "../../lib/scheduledMeetings";
import { listUpcomingCompanyEvents } from "../../lib/companyEvents";
import { useVisibilityPausedInterval } from "../../hooks/useVisibilityPausedInterval";
import UpcomingMeetingsWidget from "../office/UpcomingMeetingsWidget";
import WidgetChip from "./WidgetChip";

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Pinned-strip chip for upcoming meetings: the SOONEST meeting's start time in
// the pill, the full meetings card in the popover. Merges room meetings + shared
// company events (the same sources the card shows) so "next" is actually the
// next — querying only room meetings missed a nearer company event, which is why
// it looked like the chip showed nothing. Polls once a minute, paused when
// hidden.
export default function MeetingsChip({ dark }) {
  const { activeTeamId } = useTeam();
  const [next, setNext] = useState(null);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setNext(null); return; }
    const [meetings, company] = await Promise.all([
      listUpcomingMeetings(activeTeamId, 3),
      listUpcomingCompanyEvents(activeTeamId, 3),
    ]);
    const merged = [
      ...(meetings.data || []).map((m) => ({ title: m.title, starts_at: m.starts_at })),
      ...(company.data || []).map((c) => ({ title: c.title, starts_at: c.starts_at })),
    ].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    setNext(merged[0] || null);
  }, [activeTeamId]);
  useEffect(() => { reload(); }, [reload]);
  useVisibilityPausedInterval(reload, 60000, { enabled: !!activeTeamId });

  return (
    <WidgetChip
      icon={CalendarDays}
      name={next ? (next.title || "Meeting") : "No meetings"}
      value={next ? timeLabel(next.starts_at) : null}
      title={next ? `Next: ${next.title || "meeting"} at ${timeLabel(next.starts_at)}` : "Upcoming meetings"}
      dark={dark}
    >
      <UpcomingMeetingsWidget dark={dark} />
    </WidgetChip>
  );
}
