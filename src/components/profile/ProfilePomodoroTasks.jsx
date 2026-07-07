import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { listRecentTaskSegments } from "../../lib/taskSegments";

// "Focus tasks" — what you captured after each pomodoro block. The "What did you
// work on?" popup (ReflectionPrompt / the Electron popover) renames your live
// task segment, so these rows ARE those post-focus captures. Self-only + read
// only — task_segments RLS returns own rows, so this card is rendered for isMe.
const WINDOW_DAYS = 14;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dayLabel(ts) {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Compact duration — "25m", "1h", "1h 20m". Nicer than formatDuration's
// "0h 25m" for the many sub-hour focus blocks.
function durLabel(mins) {
  if (mins == null) return "ongoing";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function ProfilePomodoroTasks({ cardStyle }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [segments, setSegments] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const since = Date.now() - WINDOW_DAYS * 86400000;
    let cancelled = false;
    listRecentTaskSegments(since).then(({ data }) => {
      if (cancelled) return;
      setSegments((data || []).filter((s) => (s.description || "").trim()));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Group newest-first (the query already orders started_at desc) into day
  // buckets, preserving order.
  const groups = [];
  const byDay = new Map();
  for (const s of segments) {
    const key = startOfDay(s.started_at);
    if (!byDay.has(key)) {
      const g = { key, label: dayLabel(s.started_at), items: [] };
      byDay.set(key, g);
      groups.push(g);
    }
    byDay.get(key).items.push(s);
  }

  return (
    <div className="rounded-2xl border shadow-sm mt-3 p-3.5" style={cardStyle}>
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="w-4 h-4 text-[var(--color-accent)]" />
        <h2 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Focus tasks</h2>
        <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>last {WINDOW_DAYS} days</span>
      </div>

      {!loaded ? (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>Loading…</p>
      ) : groups.length === 0 ? (
        <p className={`text-xs leading-relaxed ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Nothing yet. When a focus block ends, the “What did you work on?” prompt logs it here — turn it on in Settings under reflections.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {g.label}
              </p>
              <ul className="space-y-1">
                {g.items.map((s) => {
                  const start = new Date(s.started_at).getTime();
                  const end = s.ended_at ? new Date(s.ended_at).getTime() : null;
                  const mins = end != null ? Math.max(0, Math.round((end - start) / 60000)) : null;
                  return (
                    <li
                      key={s.id}
                      className={`flex items-baseline gap-2 rounded-lg px-2 py-1.5 ${
                        dark ? "bg-[var(--color-surface-raised)]/40" : "bg-slate-50"
                      }`}
                    >
                      <span className={`flex-1 min-w-0 text-xs ${dark ? "text-slate-200" : "text-slate-700"}`}>
                        {s.description}
                      </span>
                      <span className={`shrink-0 text-[10px] tabular-nums ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        {timeLabel(s.started_at)} · {durLabel(mins)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
