import { useCallback, useEffect, useState } from "react";
import {
  Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
  MapPin, Search, Loader2, LocateFixed, Pencil,
} from "lucide-react";
import { geocodeCity, fetchWeather, weatherInfo } from "../../lib/weather";
import { useVisibilityPausedInterval } from "../../hooks/useVisibilityPausedInterval";
import WidgetSection from "./WidgetSection";

// WMO condition `kind` → lucide icon (shared with the chip). Mirrors the kiosk's
// WEATHER_ICONS so both surfaces read identically.
export const WEATHER_ICONS = {
  "clear-day": Sun, "clear-night": Moon, "partly-day": CloudSun, "partly-night": CloudMoon,
  cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};

const KEY = "ql_weather";
const SYNC_EVENT = "mango:weather-cfg";

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && typeof c === "object") return { name: c.name || "", lat: c.lat ?? null, lon: c.lon ?? null, unit: c.unit === "celsius" ? "celsius" : "fahrenheit" };
  } catch { /* */ }
  return { name: "", lat: null, lon: null, unit: "fahrenheit" };
}
function saveCfg(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* */ }
  try { window.dispatchEvent(new CustomEvent(SYNC_EVENT)); } catch { /* */ }
}

// Weather config + live data. Config (city + unit) is per-device (localStorage);
// a custom event keeps the card + the strip chip in sync when the city changes.
// Refetches every 20 min (paused when the tab is hidden).
export function useWeather() {
  const [cfg, setCfg] = useState(loadCfg);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const hasPlace = cfg.lat != null;

  // Re-read the shared config when another instance changes it.
  useEffect(() => {
    const onSync = () => setCfg(loadCfg());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const reload = useCallback(async () => {
    if (cfg.lat == null) { setData(null); return; }
    try { setErr(false); setData(await fetchWeather(cfg.lat, cfg.lon, cfg.unit)); }
    catch { setErr(true); }
  }, [cfg.lat, cfg.lon, cfg.unit]);
  useEffect(() => { reload(); }, [reload]);
  useVisibilityPausedInterval(reload, 20 * 60 * 1000, { enabled: hasPlace });

  const setPlace = (p) => setCfg((c) => { const n = { ...c, ...p }; saveCfg(n); return n; });
  const setUnit = (unit) => setCfg((c) => { const n = { ...c, unit }; saveCfg(n); return n; });
  return { cfg, data, err, hasPlace, setPlace, setUnit };
}

// City search / "locate me" — shown when no city is set, or from the edit toggle.
function CityPicker({ dark, onPick, onCancel }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true); setNotFound(false);
    try {
      const hit = await geocodeCity(q);
      if (hit) onPick({ name: hit.name, lat: hit.lat, lon: hit.lon });
      else setNotFound(true);
    } catch { setNotFound(true); }
    setBusy(false);
  };
  const locate = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onPick({ name: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude }); setBusy(false); },
      () => setBusy(false),
      { timeout: 8000 },
    );
  };
  const inputCls = dark
    ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => { setQuery(e.target.value); setNotFound(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="Search a city…"
            className={`w-full pl-7 pr-2 py-1.5 rounded-md border text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${inputCls}`}
          />
        </div>
        <button
          type="button"
          onClick={search}
          disabled={!query.trim() || busy}
          aria-label="Search"
          className="shrink-0 p-1.5 rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        </button>
      </div>
      {notFound && <p className="text-[11px] text-[var(--color-danger)]">No match — try a bigger nearby city.</p>}
      <div className="flex items-center gap-2">
        {navigator.geolocation && (
          <button type="button" onClick={locate} className={`inline-flex items-center gap-1 text-[11px] font-medium ${dark ? "text-slate-300 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}>
            <LocateFixed className="w-3.5 h-3.5" /> Use my location
          </button>
        )}
        {onCancel && <button type="button" onClick={onCancel} className="ml-auto text-[11px] text-slate-400 hover:text-slate-500">Cancel</button>}
      </div>
    </div>
  );
}

// Current conditions + a 3-day forecast for the user's city. Themed for the
// app (light/dark), unlike the kiosk's white-on-dark panel. Reuses the shared
// weather lib + icons. Set/change the city inline; toggle °F/°C.
export default function WeatherWidget({ dark, bare = false }) {
  const { cfg, data, err, hasPlace, setPlace, setUnit } = useWeather();
  const [editing, setEditing] = useState(false);

  const cur = data?.current;
  const info = cur ? weatherInfo(cur.weather_code, cur.is_day) : null;
  const Icon = info ? (WEATHER_ICONS[info.kind] || Cloud) : Cloud;
  const daily = data?.daily;
  const unitF = cfg.unit === "fahrenheit";

  const muted = dark ? "text-slate-400" : "text-slate-500";
  const faint = dark ? "text-slate-500" : "text-slate-400";

  const body = (
    <div className="space-y-3">
      {!hasPlace || editing ? (
        <CityPicker
          dark={dark}
          onPick={(p) => { setPlace(p); setEditing(false); }}
          onCancel={hasPlace ? () => setEditing(false) : null}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold truncate min-w-0 ${muted}`}>
              <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{cfg.name}</span>
            </span>
            <button type="button" onClick={() => setEditing(true)} aria-label="Change city" title="Change city" className={`shrink-0 p-1 rounded ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}>
              <Pencil className="w-3 h-3" />
            </button>
          </div>

          {!data ? (
            <p className={`text-xs ${muted}`}>{err ? "Weather unavailable." : "Loading…"}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Icon className="w-12 h-12 shrink-0" style={{ color: "var(--color-accent)" }} />
                <div className="min-w-0">
                  <span className={`block text-4xl font-bold tabular-nums leading-none ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    {Math.round(cur.temperature_2m)}°
                  </span>
                  <span className={`block text-xs mt-1 truncate ${muted}`}>{info.label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUnit(unitF ? "celsius" : "fahrenheit")}
                  title="Switch units"
                  className={`ml-auto self-start shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
                >
                  °{unitF ? "F" : "C"}
                </button>
              </div>
              <div className={`text-[11px] ${faint}`}>
                Feels {Math.round(cur.apparent_temperature)}° · Wind {Math.round(cur.wind_speed_10m)} {unitF ? "mph" : "km/h"}
              </div>
              {daily?.time?.length > 1 && (
                <div className="flex items-stretch gap-1.5 pt-0.5">
                  {daily.time.slice(1, 4).map((t, i) => {
                    const di = weatherInfo(daily.weather_code[i + 1], 1);
                    const DIcon = WEATHER_ICONS[di.kind] || Cloud;
                    const day = new Date(`${t}T00:00`).toLocaleDateString([], { weekday: "short" });
                    return (
                      <div key={t} className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-2 ${dark ? "bg-white/5" : "bg-slate-100"}`}>
                        <span className={`text-[10px] ${faint}`}>{day}</span>
                        <DIcon className={`w-5 h-5 ${muted}`} />
                        <span className={`text-[11px] tabular-nums ${dark ? "text-slate-300" : "text-slate-600"}`}>
                          {Math.round(daily.temperature_2m_max[i + 1])}°<span className={faint}> {Math.round(daily.temperature_2m_min[i + 1])}°</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );

  if (bare) return <div className="h-full overflow-y-auto p-3">{body}</div>;
  return (
    <WidgetSection id="weather" icon={Cloud} title="Weather" dark={dark}>
      {body}
    </WidgetSection>
  );
}
