import { useMemo, useState } from "react";
import { X, Globe } from "lucide-react";
import { browserTimezone } from "../../lib/timezone";
import { CityTimezonePicker } from "../worldclock/clockShared";

// Shows the meeting's start time across time zones with UTC offsets, and lets the
// organizer ADD arbitrary zones — e.g. a teammate who's traveling and isn't in
// their account's default zone. Reuses the world-clock CityTimezonePicker.

function fmtInZone(date, tz) {
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(date);
    const off = parts.find((p) => p.type === "timeZoneName")?.value || "";
    return { time, off };
  } catch { return { time: "—", off: "" }; }
}
function dayDiff(date, tz, baseTz) {
  try {
    const a = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
    const b = new Intl.DateTimeFormat("en-CA", { timeZone: baseTz }).format(date);
    if (a === b) return null;
    return a > b ? "next day" : "prev day";
  } catch { return null; }
}
const cityOf = (tz) => (tz || "").split("/").pop().replace(/_/g, " ");

export default function MeetingTimezones({ start, attendeeZones = [], dark, fieldCls }) {
  const ownTz = browserTimezone();
  const [extra, setExtra] = useState([]); // [{ tz, city }]

  const rows = useMemo(() => {
    const out = [{ key: "you", primary: "You", sub: cityOf(ownTz), tz: ownTz }];
    attendeeZones.forEach((z, i) => out.push({ key: `a${i}`, primary: z.label, sub: cityOf(z.tz), tz: z.tz }));
    extra.forEach((z, i) => out.push({ key: `x${i}`, primary: z.city || cityOf(z.tz), sub: cityOf(z.tz), tz: z.tz, removeIdx: i }));
    return out;
  }, [ownTz, attendeeZones, extra]);

  if (!start) return null;

  return (
    <div className={`rounded-lg border p-2.5 ${dark ? "border-[var(--color-border)] bg-white/5" : "border-slate-200 bg-slate-50"}`}>
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        <Globe className="w-3.5 h-3.5" /> Across time zones
      </div>
      <ul className="space-y-1">
        {rows.map((r) => {
          const { time, off } = fmtInZone(start, r.tz);
          const diff = dayDiff(start, r.tz, ownTz);
          return (
            <li key={r.key} className="flex items-center gap-2 text-xs">
              <div className="min-w-0 flex-1 truncate">
                <span className={`font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{r.primary}</span>
                {r.sub && <span className={`ml-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>{r.sub}</span>}
              </div>
              {diff && <span className={`text-[10px] px-1 rounded shrink-0 ${dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-600"}`}>{diff}</span>}
              <span className={`tabular-nums font-semibold shrink-0 ${dark ? "text-slate-100" : "text-slate-800"}`}>{time}</span>
              <span className={`text-[10px] tabular-nums shrink-0 w-12 text-right ${dark ? "text-slate-500" : "text-slate-400"}`}>{off}</span>
              {r.removeIdx !== undefined ? (
                <button type="button" aria-label="Remove" onClick={() => setExtra((prev) => prev.filter((_, i) => i !== r.removeIdx))} className={`shrink-0 ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}>
                  <X className="w-3 h-3" />
                </button>
              ) : <span className="w-3 shrink-0" />}
            </li>
          );
        })}
      </ul>
      <div className="mt-2">
        <CityTimezonePicker
          dark={dark}
          fieldCls={fieldCls}
          placeholder="Add a city / zone (e.g. a traveling teammate)…"
          onPick={(sel) => setExtra((prev) => [...prev, { tz: sel.tz, city: sel.city }])}
        />
      </div>
    </div>
  );
}
