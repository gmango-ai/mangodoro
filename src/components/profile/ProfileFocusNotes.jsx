import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { listRecentFocusNotes } from "../../lib/focusNotes";

// "Focus notes" — a journal of the reflections captured by the "What did you
// work on?" prompt after each focus block, each with its optional Result status
// (In progress / Done / Blocked), grouped by day. Self-only + read-only
// (focus_notes RLS returns own rows), so this is rendered for isMe.
const WINDOW_DAYS = 30;

const STATUS_META = {
  in_progress: { label: "In progress", cls: "text-sky-600 bg-sky-500/10 border-sky-500/30", clsDark: "text-sky-300 bg-sky-500/15 border-sky-500/30" },
  done: { label: "Done", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", clsDark: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30" },
  blocked: { label: "Blocked", cls: "text-rose-600 bg-rose-500/10 border-rose-500/30", clsDark: "text-rose-300 bg-rose-500/15 border-rose-500/30" },
};

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

export default function ProfileFocusNotes({ cardStyle }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const since = Date.now() - WINDOW_DAYS * 86400000;
    let cancelled = false;
    listRecentFocusNotes(since).then(({ data }) => {
      if (cancelled) return;
      setNotes((data || []).filter((n) => (n.text || "").trim()));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Group newest-first (query is created_at desc) into day buckets, order kept.
  const groups = [];
  const byDay = new Map();
  for (const n of notes) {
    const key = startOfDay(n.created_at);
    if (!byDay.has(key)) {
      const g = { key, label: dayLabel(n.created_at), items: [] };
      byDay.set(key, g);
      groups.push(g);
    }
    byDay.get(key).items.push(n);
  }

  return (
    <div className="rounded-2xl border shadow-sm mt-3 p-3.5" style={cardStyle}>
      <div className="flex items-center gap-2 mb-3">
        <NotebookPen className="w-4 h-4 text-[var(--color-accent)]" />
        <h2 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Focus notes</h2>
        <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>last {WINDOW_DAYS} days</span>
      </div>

      {!loaded ? (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>Loading…</p>
      ) : groups.length === 0 ? (
        <p className={`text-xs leading-relaxed ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Nothing yet. When a focus block ends, jot a note in the “What did you work on?” prompt and it’ll be saved here — turn it on in Settings under reflections.
        </p>
      ) : (
        <div className="space-y-3.5">
          {groups.map((g) => (
            <div key={g.key}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {g.label}
              </p>
              <ul className="space-y-2">
                {g.items.map((n) => {
                  const meta = n.status ? STATUS_META[n.status] : null;
                  return (
                    <li key={n.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 text-[10px] tabular-nums ${dark ? "text-slate-500" : "text-slate-400"}`}>
                          {timeLabel(n.created_at)}
                        </span>
                        {meta && (
                          <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${dark ? meta.clsDark : meta.cls}`}>
                            {meta.label}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs leading-relaxed whitespace-pre-wrap break-words ${dark ? "text-slate-200" : "text-slate-700"}`}>
                        {n.text}
                      </p>
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
