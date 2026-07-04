import { usePresenceTimeline } from "../../hooks/usePresenceTimeline";
import { presenceClass } from "../../lib/presenceTimeline";
import { formatDuration } from "../../lib/utils";

// Device-local presence timeline for the current user's own profile — a way to
// eyeball that the resolver's active/away/offline detection is behaving (walk
// away → Away; close the app → Offline). Self-only; data lives in localStorage.

const COLOR = { active: "bg-emerald-500", away: "bg-amber-400", offline: "bg-slate-300 dark:bg-slate-600" };
const LABEL = { active: "Active", away: "Away", offline: "Offline" };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmt = (ms) => formatDuration(Math.round(ms / 60000));

export default function ProfilePresenceTimeline() {
  const { segments, totals } = usePresenceTimeline();
  const span = segments.length ? segments[segments.length - 1].end - segments[0].start : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Presence today</h3>
        <span className="text-[11px] text-slate-400">this device</span>
      </div>

      {segments.length === 0 ? (
        <p className="text-xs text-slate-400">
          Collecting… your active / away / offline timeline builds as you use the app.
        </p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-black/5">
            {segments.map((s, i) => {
              const pct = span ? ((s.end - s.start) / span) * 100 : 0;
              if (pct <= 0) return null;
              const cls = presenceClass(s.a);
              return (
                <div
                  key={i}
                  style={{ width: `${pct}%` }}
                  className={COLOR[cls]}
                  title={`${LABEL[cls]} · ${clock(s.start)}–${clock(s.end)}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>{clock(segments[0].start)}</span>
            <span>{clock(segments[segments.length - 1].end)}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {["active", "away", "offline"].map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className={`h-2 w-2 rounded-full ${COLOR[c]}`} />
                {LABEL[c]}
                <span className="text-slate-400">{fmt(totals[c])}</span>
              </span>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-slate-400">
            Reflects this device while the app is open; gaps over ~2 min register as offline.
            Handy for checking that walking away flips you to Away and closing the app shows Offline.
          </p>
        </>
      )}
    </div>
  );
}
