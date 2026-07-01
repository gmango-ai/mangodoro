import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Search } from "lucide-react";
import { localTimeLabel, tzAbbrev, localMinutes } from "../../lib/timezone";
import { searchCities, preloadCities } from "../../lib/citySearch";

// Shared world-clock building blocks, used by BOTH the office sidebar widget
// (WorldClockWidget) and the nav globe dropdown (WorldClockNav) so the time rows
// and city picker stay identical. Times are formatted with the Intl helpers in
// lib/timezone.js — no date library.

// Day at the location → sun, night → moon. Coarse 6am–8pm "day" window; it only
// drives a glanceable icon, not anything precise.
export function isDaytime(tz) {
  const m = localMinutes(tz);
  if (m == null) return true;
  return m >= 6 * 60 && m < 20 * 60;
}

// Whether the location's calendar date is ahead/behind the viewer's right now
// (the across-the-dateline "+1 day" / "−1 day" hint). Compares YYYY-MM-DD
// strings, which order correctly for adjacent days.
export function dayOffsetLabel(tz) {
  try {
    const here = new Intl.DateTimeFormat("en-CA").format(new Date());
    const there = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    if (there === here) return null;
    return there > here ? "+1 day" : "−1 day";
  } catch {
    return null;
  }
}

// A single "place — local time" row. `trailing` lets a caller append controls
// (e.g. a pin / remove button) after the time.
export function ClockRow({ loc, dark, trailing = null }) {
  const day = isDaytime(loc.tz);
  const time = localTimeLabel(loc.tz) || "—";
  const abbr = tzAbbrev(loc.tz);
  const off = dayOffsetLabel(loc.tz);
  return (
    <li className="flex items-center gap-2 py-1">
      {day
        ? <Sun className="w-3.5 h-3.5 shrink-0 text-amber-400" />
        : <Moon className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12px] font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>
          {loc.label}
        </div>
        {(abbr || off) && (
          <div className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {[abbr, off].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className={`tabular-nums text-[13px] font-semibold shrink-0 ${dark ? "text-slate-100" : "text-slate-800"}`}>
        {time}
      </div>
      {trailing}
    </li>
  );
}

// Type ANY city → resolve its timezone (lib/citySearch over the bundled city
// dataset). Results show the place + that zone's current time so the user
// confirms the right one. Falls back to accepting a raw IANA zone (text with a
// "/") for power users. Inline results (not an absolute popover) so they never
// clip inside a scroll area.
export function CityTimezonePicker({ tz, dark, fieldCls, onPick, placeholder }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    const id = ++reqRef.current;
    let cancelled = false;
    searchCities(term, 7).then((rows) => {
      if (cancelled || id !== reqRef.current) return;
      const extra = (!rows.length && term.includes("/"))
        ? [{ city: term, province: "", country: "", tz: term }]
        : [];
      setResults([...rows, ...extra]);
      setActive(0);
    });
    return () => { cancelled = true; };
  }, [q]);

  const choose = (r) => { onPick({ city: r.city, tz: r.tz }); setQ(""); setResults([]); };

  const onKey = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") { setResults([]); }
  };

  return (
    <div>
      <div className="relative">
        <Search className={`absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${dark ? "text-slate-500" : "text-slate-400"}`} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={preloadCities}
          onKeyDown={onKey}
          placeholder={placeholder || (tz ? "Change city…" : "Search any city…")}
          className={`w-full rounded-md border pl-7 pr-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${fieldCls}`}
        />
      </div>
      {results.length > 0 && (
        <ul className={`mt-1 rounded-md border overflow-hidden ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          {results.map((r, i) => {
            const place = [r.city, r.province, r.country].filter(Boolean).join(", ");
            const meta = [tzAbbrev(r.tz), localTimeLabel(r.tz)].filter(Boolean).join(" · ");
            return (
              <li key={`${r.tz}:${r.city}:${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                  className={`w-full text-left px-2 py-1.5 flex items-center gap-2 ${
                    active === i ? "bg-[var(--color-accent-light)]" : dark ? "hover:bg-white/5" : "hover:bg-slate-100"
                  }`}
                >
                  <span className={`flex-1 min-w-0 truncate text-[12px] ${dark ? "text-slate-200" : "text-slate-700"}`}>{place}</span>
                  <span className={`text-[10px] tabular-nums shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
