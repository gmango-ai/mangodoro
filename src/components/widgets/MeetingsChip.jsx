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

// Pinned-strip chip for upcoming meetings: the next meeting that HASN'T STARTED
// yet in the pill, the full meetings card in the popover. Merges room meetings +
// shared company events (the same sources the card shows). Once a meeting's start
// time passes it rolls to the following one — a 9:00 meeting stops showing at
// 9:00 (the underlying queries include in-progress meetings so the card can still
// offer "join", but the chip is about what's NEXT). Polls once a minute.
export default function MeetingsChip({ dark }) {
  const { activeTeamId } = useTeam();
  const [next, setNext] = useState(null);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setNext(null); return; }
    const [meetings, company] = await Promise.all([
      listUpcomingMeetings(activeTeamId, 5),
      listUpcomingCompanyEvents(activeTeamId, 5),
    ]);
    const now = Date.now();
    const merged = [
      ...(meetings.data || []).map((m) => ({ title: m.title, starts_at: m.starts_at })),
      ...(company.data || []).map((c) => ({ title: c.title, starts_at: c.starts_at })),
    ]
      .filter((m) => new Date(m.starts_at).getTime() > now) // hasn't started yet
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
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
