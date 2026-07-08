import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Video } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listUpcomingMeetings } from "../../lib/scheduledMeetings";
import WidgetSection from "./WidgetSection";

// Office sidebar widget — the team's next few scheduled meetings with a one-tap
// Join into the room. Reads scheduled_meetings (team-scoped via RLS).

function fmtWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export default function UpcomingMeetingsWidget({ dark }) {
  const { activeTeamId, rooms } = useTeam();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setRows([]); setLoaded(true); return; }
    const { data } = await listUpcomingMeetings(activeTeamId);
    setRows(data || []);
    setLoaded(true);
  }, [activeTeamId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, [reload]);

  const roomName = (id) => (rooms || []).find((r) => r.id === id)?.name || "Meeting room";

  return (
    <WidgetSection id="upcoming-meetings" icon={CalendarDays} title="Upcoming meetings" dark={dark}>
      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.map((m) => {
            const soon = new Date(m.starts_at).getTime() - Date.now() < 10 * 60 * 1000;
            return (
              <li key={m.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${dark ? "text-slate-200" : "text-slate-800"}`}>{m.title}</p>
                  <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    {fmtWhen(m.starts_at)} · {roomName(m.room_id)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/office/r/${m.room_id}`)}
                  title="Join the room"
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    soon ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]" : dark ? "bg-white/5 text-slate-300 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Video className="w-3 h-3" /> Join
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>
          {!loaded ? "Loading…" : "No upcoming meetings."}
        </p>
      )}
    </WidgetSection>
  );
}
