import { useEffect, useMemo, useRef, useState } from "react";
import {
  Video, MessageSquare, PenLine, Timer, Users, CalendarClock, MapPin, Newspaper, Settings2, Check, Trash2, Plus,
  Target, Globe, Flag, Briefcase, Cpu, FlaskConical, HeartPulse, Trophy, Clapperboard,
  Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
} from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import DevicePortalCall from "../../video/DevicePortalCall";
import UserAvatar from "../../UserAvatar";
import Modal from "../../Modal";
import { supabase } from "../../../supabase";
import { formatClock } from "../../../lib/utils";
import { useVisibilityPausedInterval } from "../../../hooks/useVisibilityPausedInterval";
import { availabilityDot, availabilityLabel } from "../../../lib/presence";
import { mergeOfficePresence } from "../../../lib/officePresence";
import { geocodeCity, fetchWeather, weatherInfo } from "../../../lib/weather";

// The KIOSK panel registry — the device-side counterpart to panels.jsx
// (ROOM_PANELS). Same shape ({ id, title, icon, min, render(ctx) }) so it drops
// straight into the shared <RoomLayout panels={DEVICE_PANELS}> + useRoomLayout.
// Differences from the member set:
//   • video   → the always-on DevicePortalCall (kiosk portal), not RoomVideoStage.
//   • chat    → RoomChatPanel in readOnly mode (the device can't post).
//   • + timer + presence widgets (a communal display wants these glanceable).
// ctx = { room, userId, displayName, dark, sess, participants, whiteboardId }.

const MODE_LABEL = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

// A panel's settings gear, placed in the tile HEADER (via the panel's
// `headerActions`) rather than overlaying the content. The header chrome and the
// panel body are rendered separately by RoomLayout, so the gear opens the body's
// config modal through a window event the body listens for (usePanelConfig).
function HeaderGear({ event, title = "Settings" }) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => window.dispatchEvent(new CustomEvent(event))}
      className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
    >
      <Settings2 className="w-3.5 h-3.5" />
    </button>
  );
}
function usePanelConfig(event, onOpen) {
  const ref = useRef(onOpen);
  ref.current = onOpen;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(event, h);
    return () => window.removeEventListener(event, h);
  }, [event]);
}

// Self-ticking so the layout doesn't have to re-render every second — the panel
// owns its countdown from the session's ends_at (running) or remaining_seconds.
export function DeviceTimerPanel({ sess }) {
  const [, force] = useState(0);
  useVisibilityPausedInterval(
    () => force((n) => (n + 1) % 1e9),
    1000,
    { enabled: !!sess?.is_running }
  );

  const secondsLeft = (() => {
    if (!sess) return 0;
    if (sess.is_running && sess.ends_at) {
      return Math.max(0, Math.ceil((new Date(sess.ends_at).getTime() - Date.now()) / 1000));
    }
    return Math.max(0, sess.remaining_seconds || 0);
  })();
  const isBreak = sess && sess.mode !== "work";

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-white p-4 overflow-hidden"
      style={{ containerType: "size" }}
    >
      {sess ? (
        <>
          <div className={`font-semibold uppercase tracking-[0.25em] mb-2 ${isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]"}`}
            style={{ fontSize: "clamp(9px, 3.5cqmin, 15px)" }}>
            {MODE_LABEL[sess.mode] || "Focus"}{!sess.is_running ? " · Paused" : ""}
          </div>
          <div
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: "min(26cqw, 52cqh)", fontFamily: "'Parkinsans', sans-serif", letterSpacing: "0.01em" }}
          >
            {formatClock(secondsLeft, { padMinutes: true })}
          </div>
        </>
      ) : (
        <p className="text-slate-500 text-sm text-center">No active session.<br />Waiting for someone to start the timer…</p>
      )}
    </div>
  );
}

// Full-org roster for the wall display: EVERYONE grouped by where they are —
// this room first, then other rooms, the hallway, away, offline. Reads the
// device_team_roster RPC (org-wide identity + status + location) and reuses the
// same mergeOfficePresence liveness the member surfaces use (no realtime roster
// on a device, so liveness is heartbeat-only). Replaces the old room-only
// "Who's here" list.
function DeviceTeamRoster({ roster, currentRoomId }) {
  const { people, roomNameById } = useMemo(() => {
    const rows = roster || [];
    const identity = {};
    const names = {};
    for (const r of rows) {
      identity[r.user_id] = { name: r.display_name, avatar: r.avatar_url };
      if (r.location_room_id && r.room_name) names[r.location_room_id] = r.room_name;
    }
    return { people: mergeOfficePresence(rows, [], identity), roomNameById: names };
  }, [roster]);

  const groups = useMemo(() => {
    const roomsG = new Map();
    const around = [], awayList = [], offline = [];
    for (const p of people) {
      if (p.locationKind === "room" && p.locationRoomId) {
        if (!roomsG.has(p.locationRoomId)) roomsG.set(p.locationRoomId, []);
        roomsG.get(p.locationRoomId).push(p);
        continue;
      }
      if (!p.online) { (p.availability === "offline" ? offline : awayList).push(p); continue; }
      around.push(p);
    }
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    const roomEntries = [...roomsG.entries()];
    const out = [];
    const cur = currentRoomId ? roomEntries.find(([rid]) => rid === currentRoomId) : null;
    if (cur) out.push({ key: `room:${cur[0]}`, label: "In this room", people: cur[1].sort(byName), highlight: true });
    roomEntries.filter(([rid]) => rid !== currentRoomId)
      .sort((a, b) => (roomNameById[a[0]] || "").localeCompare(roomNameById[b[0]] || ""))
      .forEach(([rid, list]) => out.push({ key: `room:${rid}`, label: roomNameById[rid] || "A room", people: list.sort(byName) }));
    if (around.length) out.push({ key: "around", label: "In the hallway", people: around.sort(byName) });
    if (awayList.length) out.push({ key: "away", label: "Away", people: awayList.sort(byName) });
    if (offline.length) out.push({ key: "offline", label: "Offline", people: offline.sort(byName), muted: true });
    return out;
  }, [people, roomNameById, currentRoomId]);

  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      {people.length === 0 ? (
        <p className="text-slate-500 text-sm">No teammates yet.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${g.highlight ? "text-[var(--color-accent)]" : "text-white/45"}`}>
                {g.label} <span className="tabular-nums opacity-70">{g.people.length}</span>
              </div>
              <ul className="space-y-1.5">
                {g.people.map((p) => {
                  const activity = p.online && p.activity?.label ? p.activity.label : null;
                  return (
                    <li key={p.userId} className="flex items-center gap-2.5 min-w-0">
                      <span className="relative shrink-0">
                        <UserAvatar url={p.avatar} name={p.name || "Member"} size={30} />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 ${availabilityDot(p.availability)}`} />
                      </span>
                      <span className="min-w-0 flex flex-col leading-tight">
                        <span className={`text-[12px] font-medium truncate ${g.muted || !p.online ? "text-white/45" : "text-white/90"}`}>{p.name || "Member"}</span>
                        <span className="text-[10px] text-white/50 truncate">{activity || availabilityLabel(p.availability)}</span>
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

// Compact "when" for a meeting on a glanceable display: the clock time, plus a
// relative hint while it's close ("now" / "in 8 min" / "in progress"), and the
// weekday prefix once it's not today.
export function fmtMeetingWhen(startsAt) {
  const d = new Date(startsAt);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const mu = (d.getTime() - Date.now()) / 60000;
  if (mu <= -1) return `${t} · in progress`;
  if (mu < 1) return `${t} · now`;
  if (mu < 60) return `${t} · in ${Math.round(mu)} min`;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

// The room's upcoming meetings as a layout tile (device parity with the member
// "Meetings" view). Reads scheduled_meetings for this room (RLS-scoped); an
// imminent meeting is accented, matching the page-level alert.
function DeviceMeetingsPanel({ meetings }) {
  const now = Date.now();
  const list = (meetings || []).filter((m) => new Date(m.ends_at).getTime() > now);
  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 overflow-auto">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-3">Meetings</div>
      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">No meetings scheduled for this room.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((m) => {
            const mu = (new Date(m.starts_at).getTime() - now) / 60000;
            const soon = mu <= 10 && mu >= -2;
            return (
              <li key={m.id} className="flex items-start gap-3 min-w-0">
                <span className={`mt-1 shrink-0 w-2 h-2 rounded-full ${soon ? "bg-[var(--color-accent)]" : "bg-white/25"}`} />
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-[13px] font-medium text-white/90 truncate">{m.title || "Meeting"}</span>
                  <span className={`text-[11px] truncate ${soon ? "text-[var(--color-accent)]" : "text-white/55"}`}>{fmtMeetingWhen(m.starts_at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Per-device weather: one or MANY locations (localStorage). Config (add/remove
// cities, unit) is a modal opened from the header gear (mango:cfg:weather).
const WEATHER_KEY = "ql_device_weather";
function loadWeather() {
  try {
    const v = JSON.parse(localStorage.getItem(WEATHER_KEY) || "null");
    if (v?.locations) return { locations: v.locations, unit: v.unit || "fahrenheit" };
    if (v?.lat != null) return { locations: [{ lat: v.lat, lon: v.lon, name: v.name }], unit: v.unit || "fahrenheit" }; // migrate old single
    return { locations: [], unit: "fahrenheit" };
  } catch { return { locations: [], unit: "fahrenheit" }; }
}
function saveWeather(cfg) { try { localStorage.setItem(WEATHER_KEY, JSON.stringify(cfg)); } catch { /* */ } }
const locKey = (l) => `${l.lat},${l.lon}`;
const WEATHER_ICONS = {
  "clear-day": Sun, "clear-night": Moon, "partly-day": CloudSun, "partly-night": CloudMoon,
  cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};

// Detailed single-location view: big temp + condition + feels/wind + a 3-day.
function SingleWeather({ loc, data, unitF, err }) {
  const cur = data?.current;
  const info = cur ? weatherInfo(cur.weather_code, cur.is_day) : null;
  const Icon = info ? (WEATHER_ICONS[info.kind] || Cloud) : Cloud;
  const daily = data?.daily;
  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ containerType: "size" }}>
      <div className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/60 truncate min-w-0 mb-2">
        <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{loc.name}</span>
      </div>
      {!data ? (
        <p className="text-slate-500 text-sm">{err ? "Weather unavailable." : "Loading…"}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Icon className="w-14 h-14 shrink-0" style={{ color: "var(--color-accent)" }} />
            <div className="flex flex-col leading-none min-w-0">
              <span className="font-bold tabular-nums" style={{ fontSize: "min(16cqw, 46px)", fontFamily: "'Parkinsans', sans-serif" }}>
                {Math.round(cur.temperature_2m)}°
              </span>
              <span className="text-[12px] text-white/70 mt-1 truncate">{info.label}</span>
            </div>
          </div>
          <div className="text-[11px] text-white/45 mt-1.5">
            Feels {Math.round(cur.apparent_temperature)}° · Wind {Math.round(cur.wind_speed_10m)} {unitF ? "mph" : "km/h"}
          </div>
          {daily?.time?.length > 1 && (
            <div className="mt-auto pt-3 flex items-stretch gap-2">
              {daily.time.slice(1, 4).map((t, i) => {
                const di = weatherInfo(daily.weather_code[i + 1], 1);
                const DIcon = WEATHER_ICONS[di.kind] || Cloud;
                const day = new Date(`${t}T00:00`).toLocaleDateString([], { weekday: "short" });
                return (
                  <div key={t} className="flex-1 flex flex-col items-center gap-1 rounded-lg bg-white/5 py-2">
                    <span className="text-[10px] text-white/45">{day}</span>
                    <DIcon className="w-5 h-5 text-white/70" />
                    <span className="text-[11px] tabular-nums text-white/80">
                      {Math.round(daily.temperature_2m_max[i + 1])}°<span className="text-white/40"> {Math.round(daily.temperature_2m_min[i + 1])}°</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Compact card for one location in the multi-city grid.
function WeatherCard({ loc, data }) {
  const cur = data?.current;
  const info = cur ? weatherInfo(cur.weather_code, cur.is_day) : null;
  const Icon = info ? (WEATHER_ICONS[info.kind] || Cloud) : Cloud;
  const daily = data?.daily;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
      <Icon className="w-9 h-9 shrink-0" style={{ color: "var(--color-accent)" }} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-white/55 truncate">{loc.name}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums leading-none">{cur ? Math.round(cur.temperature_2m) : "—"}°</span>
          <span className="text-[11px] text-white/50 truncate">{info?.label || ""}</span>
        </div>
      </div>
      {daily && (
        <div className="text-[11px] tabular-nums text-white/60 shrink-0">
          {Math.round(daily.temperature_2m_max[0])}°<span className="text-white/35"> {Math.round(daily.temperature_2m_min[0])}°</span>
        </div>
      )}
    </div>
  );
}

// Public-screen weather via Open-Meteo (keyless). One or many cities; config
// (add/remove, unit) opens from the header gear.
function DeviceWeatherPanel() {
  const [cfg, setCfg] = useState(loadWeather);
  const [wx, setWx] = useState({});
  const [config, setConfig] = useState(() => loadWeather().locations.length === 0);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  usePanelConfig("mango:cfg:weather", () => setConfig(true));

  const { locations, unit } = cfg;
  const unitF = unit === "fahrenheit";
  const sig = locations.map(locKey).join("|") + ":" + unit;

  useEffect(() => {
    if (!locations.length) { setWx({}); return undefined; }
    let alive = true;
    const load = async () => {
      const results = {};
      await Promise.all(locations.map(async (l) => {
        try { results[locKey(l)] = await fetchWeather(l.lat, l.lon, unit); } catch { /* */ }
      }));
      if (alive) setWx(results);
    };
    load();
    const id = setInterval(load, 20 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const addCity = async (e) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true); setErr(false);
    try {
      const hit = await geocodeCity(query);
      if (!hit) setErr(true);
      else { setCfg((c) => { const next = { ...c, locations: [...c.locations, hit] }; saveWeather(next); return next; }); setQuery(""); }
    } catch { setErr(true); }
    setBusy(false);
  };
  const removeCity = (i) => setCfg((c) => { const next = { ...c, locations: c.locations.filter((_, j) => j !== i) }; saveWeather(next); return next; });
  const setUnit = (u) => setCfg((c) => { const next = { ...c, unit: u }; saveWeather(next); return next; });

  return (
    <div className="w-full h-full bg-slate-950 text-white p-3 overflow-auto">
      {locations.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
          <MapPin className="w-6 h-6 text-white/25" />
          <p className="text-sm text-white/55">No locations yet.</p>
          <button type="button" onClick={() => setConfig(true)} className="text-[12px] font-semibold text-[var(--color-accent)]">Add a city</button>
        </div>
      ) : locations.length === 1 ? (
        <SingleWeather loc={locations[0]} data={wx[locKey(locations[0])]} unitF={unitF} err={err} />
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {locations.map((l) => <WeatherCard key={locKey(l)} loc={l} data={wx[locKey(l)]} />)}
        </div>
      )}
      <Modal open={config} onClose={() => setConfig(false)} overlayClassName="z-[300] bg-black/60">
        <div onClick={(e) => e.stopPropagation()} className="w-[min(92vw,400px)] rounded-2xl bg-slate-900 ring-1 ring-white/10 shadow-2xl p-4 text-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Weather</h3>
            <button type="button" onClick={() => setConfig(false)} className="text-[12px] font-semibold text-[var(--color-accent)]">Done</button>
          </div>
          <div className="rounded-xl bg-white/[0.03] p-2.5 mb-3">
            <SegChoice label="Units" value={unit} onChange={setUnit} options={[{ value: "fahrenheit", label: "°F" }, { value: "celsius", label: "°C" }]} />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">Locations</p>
          {locations.length > 0 && (
            <ul className="mb-2">
              {locations.map((l, i) => (
                <li key={locKey(l)} className="flex items-center gap-1">
                  <span className="flex-1 truncate text-[12px] text-white/85 px-1 py-1.5">{l.name}</span>
                  <button type="button" onClick={() => removeCity(i)} title="Remove" className="p-1 rounded text-white/30 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addCity} className="flex items-center gap-1.5">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add a city…" className="flex-1 min-w-0 rounded-md bg-white/10 px-2 py-1.5 text-[12px] text-white outline-none placeholder:text-white/35" />
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--color-accent)" }}>
              <Plus className="w-3.5 h-3.5" /> {busy ? "…" : "Add"}
            </button>
          </form>
          {err && <p className="text-[11px] text-rose-400 mt-1.5">Couldn't find that city — try another.</p>}
        </div>
      </Modal>
    </div>
  );
}

// Public-screen TICKER: a fixed number of scrolling lines (not one per source).
// Headlines from every selected feed — org GOALS (device_org_goals RPC) + news
// (news-feed edge fn, server-side RSS proxy) — are interleaved and spread across
// the lines, each prefixed with its source (category ICON + name). Line count,
// speed, text size, and sources are set in a modal, persisted per-device. Each
// line's track holds its items twice → a seamless -50% loop, pausing on hover.
const TICKER_KEY = "ql_device_ticker";
const TICKER_DEFAULTS = { lines: ["goals", "bbc-world", "hn"], rows: 3, speed: "normal", size: "md" };
function loadCfg() {
  try {
    const v = JSON.parse(localStorage.getItem(TICKER_KEY) || "null") || {};
    return {
      lines: Array.isArray(v.lines) && v.lines.length ? v.lines : TICKER_DEFAULTS.lines,
      rows: [1, 2, 3, 4, 5].includes(v.rows) ? v.rows : TICKER_DEFAULTS.rows,
      speed: ["slow", "normal", "fast"].includes(v.speed) ? v.speed : TICKER_DEFAULTS.speed,
      size: ["sm", "md", "lg"].includes(v.size) ? v.size : TICKER_DEFAULTS.size,
    };
  } catch { return { ...TICKER_DEFAULTS }; }
}
function saveCfg(cfg) { try { localStorage.setItem(TICKER_KEY, JSON.stringify(cfg)); } catch { /* */ } }

const SPEED_FACTOR = { slow: 1.7, normal: 1, fast: 0.55 };
const SIZE_CLASS = { sm: "text-[11px]", md: "text-[13px]", lg: "text-[15px]" };
const CATEGORY_ICON = {
  goals: Target, World: Globe, US: Flag, Business: Briefcase, Tech: Cpu,
  Science: FlaskConical, Health: HeartPulse, Sports: Trophy, Culture: Clapperboard,
};

// One scrolling row. `items` = [{ source, category, title }]; the source shows
// inline (category icon + name) before each headline. Duration scales with
// content length × the speed factor.
function TickerRow({ items, speedFactor, sizeClass }) {
  const totalChars = items.reduce((n, it) => n + (it.source?.length || 0) + (it.title?.length || 0) + 8, 0);
  const duration = Math.max(18, Math.round((totalChars / 7) * speedFactor));
  return (
    <div className="flex items-center border-b border-white/[0.06] last:border-b-0 overflow-hidden" style={{ flex: "1 1 0", minHeight: 0 }}>
      <div className="relative flex-1 min-w-0 overflow-hidden">
        {items.length === 0 ? (
          <span className={`pl-3 text-slate-600 ${sizeClass}`}>—</span>
        ) : (
          <div className="mango-ticker-track" style={{ animationDuration: `${duration}s` }}>
            {[0, 1].map((dup) => (
              <span key={dup} className="inline-flex items-center" aria-hidden={dup === 1}>
                {items.map((it, i) => {
                  const Icon = CATEGORY_ICON[it.category] || Newspaper;
                  return (
                    <span key={`${dup}-${i}`} className={`inline-flex items-center ${sizeClass} text-white/80`}>
                      <span className="ml-5 mr-1.5 inline-flex items-center gap-1 text-[var(--color-accent)] font-semibold">
                        <Icon className="w-[1.1em] h-[1.1em] shrink-0" />
                        <span className="uppercase tracking-wide text-[0.82em] whitespace-nowrap">{it.source}</span>
                      </span>
                      <span className="mr-2 text-white/25">·</span>
                      <span className="whitespace-nowrap">{it.title}</span>
                    </span>
                  );
                })}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TickerToggle({ label, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
        on ? "bg-[var(--color-accent)]/15 text-white ring-1 ring-[var(--color-accent)]/40" : "bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      <span className="truncate">{label}</span>
      {on && <Check className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]" />}
    </button>
  );
}

// Small segmented control (line count / speed / text size).
function SegChoice({ label, value, options, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 last:mb-0">
      <span className="text-[11px] text-white/60">{label}</span>
      <div className="inline-flex p-0.5 rounded-lg bg-white/5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              value === o.value ? "bg-[var(--color-accent)] text-white" : "text-white/55 hover:text-white/90"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DeviceTickerPanel() {
  const [cfg, setCfg] = useState(loadCfg);
  const [newsByKey, setNewsByKey] = useState({});
  const [available, setAvailable] = useState([]); // [{ key, name, category }]
  const [goals, setGoals] = useState([]);
  const [picking, setPicking] = useState(false);

  usePanelConfig("mango:cfg:ticker", () => setPicking(true));

  const { lines, rows, speed, size } = cfg;
  const newsKeys = lines.filter((l) => l !== "goals");
  const wantGoals = lines.includes("goals");
  const newsSig = newsKeys.join(",");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await supabase.functions.invoke("news-feed", { body: { keys: newsSig ? newsSig.split(",") : [] } });
        if (!alive) return;
        const map = {};
        for (const f of data?.feeds || []) map[f.key] = f;
        setNewsByKey(map);
        if (data?.available?.length) setAvailable(data.available);
      } catch { /* leave as-is */ }
    };
    load();
    const id = setInterval(load, 12 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [newsSig]);

  useEffect(() => {
    if (!wantGoals) { setGoals([]); return undefined; }
    let alive = true;
    const load = async () => {
      const { data } = await supabase.rpc("device_org_goals");
      if (alive) setGoals(data || []);
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [wantGoals]);

  const update = (patch) => setCfg((c) => { const next = { ...c, ...patch }; saveCfg(next); return next; });
  const toggle = (id) => {
    const next = lines.includes(id) ? lines.filter((x) => x !== id) : [...lines, id];
    update({ lines: next.length ? next : lines });
  };

  const catByKey = useMemo(() => Object.fromEntries(available.map((a) => [a.key, a.category])), [available]);

  // Interleave every selected feed's items (round-robin so no source dominates),
  // then spread that pool across the fixed rows.
  const rowItems = useMemo(() => {
    const feeds = [];
    if (wantGoals) feeds.push({ source: "Goals", category: "goals", items: goals.map((g) => ({ title: g.body })) });
    for (const k of newsSig ? newsSig.split(",") : []) {
      const f = newsByKey[k];
      if (f?.items?.length) feeds.push({ source: f.source, category: catByKey[k] || "News", items: f.items });
    }
    const pooled = [];
    const max = Math.max(0, ...feeds.map((f) => f.items.length));
    for (let i = 0; i < max; i++) {
      for (const f of feeds) if (f.items[i]) pooled.push({ source: f.source, category: f.category, title: f.items[i].title });
    }
    const buckets = Array.from({ length: rows }, () => []);
    pooled.forEach((it, i) => buckets[i % rows].push(it));
    return buckets;
  }, [newsByKey, goals, catByKey, rows, newsSig, wantGoals]);

  const cats = [...new Set(available.map((a) => a.category))];
  const speedFactor = SPEED_FACTOR[speed] || 1;
  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.md;
  const hasAny = rowItems.some((b) => b.length);

  return (
    <div className="relative w-full h-full bg-slate-950 text-white flex flex-col overflow-hidden">
      {!hasAny ? (
        <div className="flex-1 flex items-center pl-3 text-[12px] text-slate-500">
          {lines.length === 0 ? "Add sources with the gear." : "Loading…"}
        </div>
      ) : (
        rowItems.map((items, i) => <TickerRow key={i} items={items} speedFactor={speedFactor} sizeClass={sizeClass} />)
      )}
      <Modal open={picking} onClose={() => setPicking(false)} overlayClassName="z-[300] bg-black/60">
        <div onClick={(e) => e.stopPropagation()} className="w-[min(92vw,440px)] max-h-[82vh] overflow-auto rounded-2xl bg-slate-900 ring-1 ring-white/10 shadow-2xl p-4 text-white dark">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Ticker</h3>
            <button type="button" onClick={() => setPicking(false)} className="text-[12px] font-semibold text-[var(--color-accent)]">Done</button>
          </div>
          <div className="rounded-xl bg-white/[0.03] p-2.5 mb-3">
            <SegChoice label="Lines" value={rows} onChange={(v) => update({ rows: v })}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
            <SegChoice label="Speed" value={speed} onChange={(v) => update({ speed: v })}
              options={[{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]} />
            <SegChoice label="Text size" value={size} onChange={(v) => update({ size: v })}
              options={[{ value: "sm", label: "S" }, { value: "md", label: "M" }, { value: "lg", label: "L" }]} />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">Updates</p>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <TickerToggle label="Goals" on={lines.includes("goals")} onClick={() => toggle("goals")} />
          </div>
          {cats.map((cat) => (
            <div key={cat} className="mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">{cat}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {available.filter((a) => a.category === cat).map((a) => (
                  <TickerToggle key={a.key} label={a.name} on={lines.includes(a.key)} onClick={() => toggle(a.key)} />
                ))}
              </div>
            </div>
          ))}
          {cats.length === 0 && <p className="text-[11px] text-white/40">Loading sources…</p>}
        </div>
      </Modal>
    </div>
  );
}

export const DEVICE_PANELS = {
  video: {
    id: "video",
    title: "Video",
    icon: Video,
    min: 280,
    // key by room.id so a room switch cleanly remounts the call (fresh LiveKit
    // connection to the new room) rather than trying to reuse the old one.
    // active = a human is in the call; the portal stays idle (no LiveKit media)
    // until then, so the kiosk doesn't publish 24/7.
    render: ({ room, displayName, someoneInCall }) => (
      <DevicePortalCall key={room.id} roomId={room.id} displayName={displayName} active={!!someoneInCall} />
    ),
  },
  timer: {
    id: "timer",
    title: "Timer",
    icon: Timer,
    min: 200,
    render: ({ sess }) => <DeviceTimerPanel sess={sess} />,
  },
  presence: {
    id: "presence",
    title: "Team",
    icon: Users,
    min: 200,
    render: ({ roster, currentRoomId }) => <DeviceTeamRoster roster={roster} currentRoomId={currentRoomId} />,
  },
  meetings: {
    id: "meetings",
    title: "Meetings",
    icon: CalendarClock,
    min: 200,
    render: ({ meetings }) => <DeviceMeetingsPanel meetings={meetings} />,
  },
  weather: {
    id: "weather",
    title: "Weather",
    icon: CloudSun,
    min: 200,
    headerActions: () => <HeaderGear event="mango:cfg:weather" title="Weather settings" />,
    render: () => <DeviceWeatherPanel />,
  },
  news: {
    id: "news",
    title: "Ticker",
    icon: Newspaper,
    // Low min so it can be a thin full-width banner (a line per feed — goals +
    // news) across the bottom via the outer-edge stretch.
    min: 96,
    headerActions: () => <HeaderGear event="mango:cfg:ticker" title="Ticker settings" />,
    render: () => <DeviceTickerPanel />,
  },
  chat: {
    id: "chat",
    title: "Chat",
    icon: MessageSquare,
    min: 200,
    render: ({ room, userId }) => <RoomChatPanel roomId={room.id} userId={userId} fillHeight readOnly />,
  },
  whiteboard: {
    id: "whiteboard",
    title: "Whiteboard",
    icon: PenLine,
    min: 360,
    // Device can't link or edit (RLS is SELECT-only); shows the room's linked
    // board as a live, view-only canvas.
    render: ({ whiteboardId, dark }) => <RoomWhiteboardPanel whiteboardId={whiteboardId} canLink={false} dark={dark} readOnly />,
  },
};

export const DEVICE_PANEL_IDS = Object.keys(DEVICE_PANELS);
