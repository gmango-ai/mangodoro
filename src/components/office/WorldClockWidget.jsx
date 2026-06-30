import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Plus, X, Settings2, Sun, Moon, Search } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { localTimeLabel, tzAbbrev, localMinutes } from "../../lib/timezone";
import { getWorldClockLocations, saveWorldClockLocations, blankLocation } from "../../lib/worldClock";
import { searchCities, preloadCities } from "../../lib/citySearch";
import WidgetSection from "./WidgetSection";

// World clock — an admin-curated set of "where we operate" locations with the
// current local time in each. Org-level config (teams.world_clock_locations);
// admins edit it via the cog → modal, everyone sees it. Times are formatted with
// the shared Intl helpers in lib/timezone.js (no date library).

// Day at the location → sun, night → moon. Coarse 6am–8pm "day" window; it only
// drives a glanceable icon, not anything precise.
function isDaytime(tz) {
  const m = localMinutes(tz);
  if (m == null) return true;
  return m >= 6 * 60 && m < 20 * 60;
}

// Whether the location's calendar date is ahead/behind the viewer's right now
// (the across-the-dateline "+1 day" / "−1 day" hint). Compares YYYY-MM-DD
// strings, which order correctly for adjacent days.
function dayOffsetLabel(tz) {
  try {
    const here = new Intl.DateTimeFormat("en-CA").format(new Date());
    const there = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    if (there === here) return null;
    return there > here ? "+1 day" : "−1 day";
  } catch {
    return null;
  }
}

function ClockRow({ loc, dark }) {
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
    </li>
  );
}

export default function WorldClockWidget({ dark }) {
  const { activeTeamId, isAdmin } = useTeam();
  const [locations, setLocations] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Tick so the displayed times stay fresh. The widget body only mounts when the
  // section is expanded (WidgetSection renders children lazily), so this interval
  // doesn't run while collapsed.
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setLocations([]); setLoaded(true); return; }
    const { data } = await getWorldClockLocations(activeTeamId);
    setLocations(data);
    setLoaded(true);
  }, [activeTeamId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1e9), 30000);
    return () => clearInterval(id);
  }, []);

  const action = isAdmin ? (
    <button
      type="button"
      onClick={() => setEditorOpen(true)}
      aria-label="Edit world clock locations"
      title="Edit locations"
      className={`p-1 rounded transition-colors ${
        dark ? "text-slate-500 hover:text-slate-200 hover:bg-white/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
      }`}
    >
      <Settings2 className="w-3.5 h-3.5" />
    </button>
  ) : null;

  return (
    <WidgetSection id="world-clock" icon={Globe} title="World Clock" dark={dark} action={action}>
      {locations.length > 0 ? (
        <ul className="-my-0.5 divide-y divide-transparent">
          {locations.map((loc) => <ClockRow key={loc.id} loc={loc} dark={dark} />)}
        </ul>
      ) : (
        <div className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          {!loaded ? (
            "Loading…"
          ) : isAdmin ? (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="inline-flex items-center gap-1.5 font-medium text-[var(--color-accent)] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              Add the places your team operates
            </button>
          ) : (
            "An admin hasn't added any locations yet."
          )}
        </div>
      )}

      {editorOpen && (
        <WorldClockEditor
          dark={dark}
          initial={locations}
          onClose={() => setEditorOpen(false)}
          onSave={async (next) => {
            const { data, error } = await saveWorldClockLocations(activeTeamId, next);
            if (error) return error.message || "Could not save";
            setLocations(data);
            setEditorOpen(false);
            return null;
          }}
        />
      )}
    </WidgetSection>
  );
}

// Admin editor — add/remove locations (label + IANA timezone via a datalist
// combobox) and save. A fixed overlay so it escapes the narrow sidebar column.
function WorldClockEditor({ dark, initial, onClose, onSave }) {
  const [rows, setRows] = useState(() => (initial.length ? initial.map((l) => ({ ...l })) : [blankLocation()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, blankLocation()]);

  // Picking a city sets its timezone, and fills the label with the city name
  // when the admin hasn't typed their own (so "London" is one step, but a custom
  // "HQ — London" is preserved).
  const onPickCity = (row, { city, tz }) =>
    setRow(row.id, { tz, ...(row.label.trim() ? {} : { label: city }) });

  const save = async () => {
    setSaving(true);
    setError(null);
    const msg = await onSave(rows);
    setSaving(false);
    if (msg) setError(msg);
  };

  const fieldCls = dark
    ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="World clock locations">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
      }`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold">Where we operate</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded hover:bg-black/10 ${dark ? "hover:bg-white/10" : ""}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 max-h-[55vh] overflow-y-auto space-y-2">
          {rows.map((row) => (
            <div key={row.id} className={`rounded-lg border p-2 space-y-2 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => setRow(row.id, { label: e.target.value })}
                  placeholder="Label (e.g. HQ — London)"
                  className={`flex-1 min-w-0 rounded-md border px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${fieldCls}`}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove location"
                  className={`p-1 rounded shrink-0 ${dark ? "text-slate-500 hover:text-rose-400 hover:bg-white/5" : "text-slate-400 hover:text-rose-500 hover:bg-slate-100"}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <CityTimezonePicker tz={row.tz} dark={dark} fieldCls={fieldCls} onPick={(sel) => onPickCity(row, sel)} />
              {row.tz && (
                <div className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {[row.tz, tzAbbrev(row.tz), localTimeLabel(row.tz)].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${dark ? "text-slate-300 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}
          >
            <Plus className="w-3.5 h-3.5" /> Add location
          </button>
        </div>

        {error && <p className="px-4 text-[11px] text-rose-500">{error}</p>}

        <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${dark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Type ANY city → resolve its timezone (lib/citySearch over the bundled city
// dataset). Results show the place + that zone's current time so the admin
// confirms the right one. Falls back to accepting a raw IANA zone (text with a
// "/") for power users. Inline results (not an absolute popover) so they never
// clip inside the modal's scroll area.
function CityTimezonePicker({ tz, dark, fieldCls, onPick }) {
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
          placeholder={tz ? "Change city…" : "Search any city…"}
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
