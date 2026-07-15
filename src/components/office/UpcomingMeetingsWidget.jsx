import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Video, Building2 } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listUpcomingMeetings } from "../../lib/scheduledMeetings";
import { listUpcomingCompanyEvents } from "../../lib/companyEvents";
import WidgetSection from "./WidgetSection";

// Office sidebar widget — the team's next few scheduled meetings (join into the
// room) MERGED with shared company events pulled from Google (external — no room
// to join). Both team-scoped via RLS.

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

export default function UpcomingMeetingsWidget({ dark, bare = false }) {
  const { activeTeamId, rooms } = useTeam();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setRows([]); setLoaded(true); return; }
    const [meetings, company] = await Promise.all([
      listUpcomingMeetings(activeTeamId),
      listUpcomingCompanyEvents(activeTeamId),
    ]);
    const merged = [
      ...(meetings.data || []).map((m) => ({ ...m, kind: "meeting" })),
      ...(company.data || []).map((c) => ({ id: `company:${c.ical_uid}`, kind: "company", title: c.title, starts_at: c.starts_at, location: c.location, join_url: c.payload?.joinUrl || c.html_link })),
    ].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 6);
    setRows(merged);
    setLoaded(true);
  }, [activeTeamId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, [reload]);

  const roomName = (id) => (rooms || []).find((r) => r.id === id)?.name || "Meeting room";

  return (
    <WidgetSection id="upcoming-meetings" icon={CalendarDays} title="Upcoming meetings" dark={dark} bare={bare}>
      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.map((m) => {
            const soon = new Date(m.starts_at).getTime() - Date.now() < 10 * 60 * 1000;
            const isCompany = m.kind === "company";
            return (
              <li key={m.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${dark ? "text-slate-200" : "text-slate-800"}`}>{m.title}</p>
                  <p className={`text-[11px] truncate flex items-center gap-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    {isCompany && <Building2 className="w-3 h-3 shrink-0 text-cyan-500" />}
                    {fmtWhen(m.starts_at)} · {isCompany ? (m.location || "Company") : roomName(m.room_id)}
                  </p>
                </div>
                {(isCompany ? m.join_url : m.room_id) && (
                  <button
                    type="button"
                    // Company events live outside Mangodoro (a Meet/other link or the
                    // Google event) → open there; room meetings jump into the room.
                    onClick={() => (isCompany ? window.open(m.join_url, "_blank") : navigate(`/office/r/${m.room_id}`))}
                    title={isCompany ? "Join / open the event" : "Join the room"}
                    className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      soon ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]" : dark ? "bg-white/5 text-slate-300 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Video className="w-3 h-3" /> Join
                  </button>
                )}
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
