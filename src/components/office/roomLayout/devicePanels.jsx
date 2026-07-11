import { useEffect, useMemo, useState } from "react";
import {
  Video, MessageSquare, PenLine, Timer, Users, CalendarClock, MapPin, Newspaper, Settings2, Check,
  Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
} from "lucide-react";
import RoomChatPanel from "../../RoomChatPanel";
import RoomWhiteboardPanel from "./RoomWhiteboardPanel";
import DevicePortalCall from "../../video/DevicePortalCall";
import UserAvatar from "../../UserAvatar";
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

// Per-device weather location + unit (localStorage — the kiosk has no DB write).
const WEATHER_KEY = "ql_device_weather";
function loadWeatherLoc() {
  try { const v = JSON.parse(localStorage.getItem(WEATHER_KEY) || "null"); return v && v.lat != null ? v : null; }
  catch { return null; }
}
function saveWeatherLoc(loc) {
  try { localStorage.setItem(WEATHER_KEY, JSON.stringify(loc)); } catch { /* */ }
}
const WEATHER_ICONS = {
  "clear-day": Sun, "clear-night": Moon, "partly-day": CloudSun, "partly-night": CloudMoon,
  cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};

// Public-screen weather via Open-Meteo (keyless). The operator sets a city once
// (geocoded + stored per-device); the panel then shows current conditions + a
// short forecast, refreshed every 20 min.
function DeviceWeatherPanel() {
  const [loc, setLoc] = useState(loadWeatherLoc);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(() => !loadWeatherLoc());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loc) { setData(null); return undefined; }
    let alive = true;
    const load = async () => {
      try { const w = await fetchWeather(loc.lat, loc.lon, loc.unit || "fahrenheit"); if (alive) { setData(w); setErr(false); } }
      catch { if (alive) setErr(true); }
    };
    load();
    const id = setInterval(load, 20 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [loc]);

  const submit = async (e) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true); setErr(false);
    try {
      const hit = await geocodeCity(query);
      if (!hit) { setErr(true); }
      else {
        const next = { ...hit, unit: loc?.unit || "fahrenheit" };
        setLoc(next); saveWeatherLoc(next); setEditing(false); setQuery("");
      }
    } catch { setErr(true); }
    setBusy(false);
  };
  const toggleUnit = () => {
    if (!loc) return;
    const next = { ...loc, unit: (loc.unit || "fahrenheit") === "fahrenheit" ? "celsius" : "fahrenheit" };
    setLoc(next); saveWeatherLoc(next);
  };

  if (editing || !loc) {
    return (
      <div className="w-full h-full bg-slate-950 text-white p-4 flex flex-col justify-center gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Weather</div>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a city…"
            className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--color-accent)" }}>
              {busy ? "Finding…" : "Set location"}
            </button>
            {loc && <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-white/60 text-[12px] hover:text-white/90">Cancel</button>}
          </div>
          {err && <p className="text-[11px] text-rose-400">Couldn't find that place — try another city.</p>}
        </form>
      </div>
    );
  }

  const cur = data?.current;
  const info = cur ? weatherInfo(cur.weather_code, cur.is_day) : null;
  const Icon = info ? (WEATHER_ICONS[info.kind] || Cloud) : Cloud;
  const unitF = (loc.unit || "fahrenheit") === "fahrenheit";
  const daily = data?.daily;
  return (
    <div className="w-full h-full bg-slate-950 text-white p-4 flex flex-col overflow-hidden" style={{ containerType: "size" }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/60 truncate min-w-0">
          <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{loc.name}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={toggleUnit} className="text-[10px] font-bold text-white/45 hover:text-white/90 tabular-nums">{unitF ? "°F" : "°C"}</button>
          <button type="button" onClick={() => setEditing(true)} title="Change location" className="text-white/40 hover:text-white/90"><PenLine className="w-3.5 h-3.5" /></button>
        </span>
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

// Public-screen news ticker. Headlines come from the `news-feed` edge function
// (server-side RSS proxy — browsers can't fetch feeds). Runs ONE scrolling line
// per selected source (the track holds the headlines twice → seamless -50%
// loop, pausing on hover). Sources are picked per-device via a small gear.
const NEWS_KEY = "ql_device_news";
const NEWS_SOURCES_FALLBACK = [
  { key: "world", label: "World" }, { key: "us", label: "US" },
  { key: "business", label: "Business" }, { key: "tech", label: "Tech" },
  { key: "science", label: "Science" }, { key: "health", label: "Health" },
  { key: "sports", label: "Sports" }, { key: "culture", label: "Culture" },
];
const NEWS_DEFAULT_KEYS = ["world", "business", "tech", "science"];
function loadNewsKeys() {
  try {
    const v = JSON.parse(localStorage.getItem(NEWS_KEY) || "null");
    return Array.isArray(v?.keys) && v.keys.length ? v.keys : NEWS_DEFAULT_KEYS;
  } catch { return NEWS_DEFAULT_KEYS; }
}

// One scrolling headline line for a single source.
function TickerLine({ source, items }) {
  const totalChars = items.reduce((n, it) => n + (it.title?.length || 0) + 6, 0);
  const duration = Math.max(24, Math.round(totalChars / 7));
  return (
    <div className="flex items-center border-b border-white/[0.06] last:border-b-0 overflow-hidden" style={{ flex: "1 1 0", minHeight: 0 }}>
      <span className="shrink-0 self-stretch inline-flex items-center gap-1.5 px-2.5 w-[96px] bg-white/[0.05] text-[var(--color-accent)]">
        <Newspaper className="w-3 h-3 shrink-0" />
        <span className="text-[9px] font-bold uppercase tracking-wider truncate">{source}</span>
      </span>
      <div className="relative flex-1 min-w-0 overflow-hidden">
        {items.length === 0 ? (
          <span className="pl-3 text-[11px] text-slate-600">No headlines</span>
        ) : (
          <div className="mango-ticker-track" style={{ animationDuration: `${duration}s` }}>
            {[0, 1].map((dup) => (
              <span key={dup} className="inline-flex items-center" aria-hidden={dup === 1}>
                {items.map((it, i) => (
                  <span key={`${dup}-${i}`} className="inline-flex items-center text-[12px] text-white/80">
                    <span className="mx-4 w-1 h-1 rounded-full bg-[var(--color-accent)] shrink-0" />
                    {it.title}
                  </span>
                ))}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceNewsPanel() {
  const [keys, setKeys] = useState(loadNewsKeys);
  const [feeds, setFeeds] = useState([]);
  const [available, setAvailable] = useState(NEWS_SOURCES_FALLBACK);
  const [err, setErr] = useState(false);
  const [picking, setPicking] = useState(false);

  const sig = keys.join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("news-feed", { body: { keys: sig.split(",") } });
        if (!alive) return;
        setFeeds(data?.feeds || []);
        if (data?.available?.length) setAvailable(data.available.map((a) => ({ key: a.key, label: a.name })));
        setErr(!!error || !data?.feeds?.length);
      } catch { if (alive) setErr(true); }
    };
    load();
    const id = setInterval(load, 12 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [sig]);

  const toggle = (k) => {
    setKeys((cur) => {
      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      const final = next.length ? next : ["world"]; // keep at least one line
      try { localStorage.setItem(NEWS_KEY, JSON.stringify({ keys: final })); } catch { /* */ }
      return final;
    });
  };

  return (
    <div className="relative w-full h-full bg-slate-950 text-white flex flex-col overflow-hidden">
      {feeds.length === 0 ? (
        <div className="flex-1 flex items-center pl-3 text-[12px] text-slate-500">
          {err ? "News unavailable." : "Loading headlines…"}
        </div>
      ) : (
        feeds.map((f) => <TickerLine key={f.key} source={f.source} items={f.items} />)
      )}
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        title="Choose news sources"
        className="absolute top-1 right-1 z-20 p-1 rounded-md text-white/25 hover:text-white/80 bg-slate-950/70"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {picking && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setPicking(false)} />
          <div className="absolute top-8 right-1 z-30 w-40 p-1.5 rounded-lg bg-slate-900 ring-1 ring-white/10 shadow-2xl">
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40 px-1.5 pb-1">News sources</div>
            {available.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className="w-full flex items-center justify-between px-1.5 py-1 rounded text-[12px] text-white/80 hover:bg-white/10"
              >
                {s.label}
                {keys.includes(s.key) && <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />}
              </button>
            ))}
          </div>
        </>
      )}
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
    render: () => <DeviceWeatherPanel />,
  },
  news: {
    id: "news",
    title: "News",
    icon: Newspaper,
    // Low min so it can be a thin full-width banner (a line per source) across
    // the bottom via the outer-edge stretch.
    min: 96,
    render: () => <DeviceNewsPanel />,
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
