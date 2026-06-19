import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, Square, ChevronDown, Music, Volume2, VolumeX, Timer as TimerIcon,
} from "lucide-react";
import { supabase } from "../../supabase";

// A plain shared countdown for the board — "set 5 minutes while everyone
// writes their thoughts, then chat." Background music loops for as long
// as the timer is running and is synced across the board (track choice is
// shared; mute is per-person).

const TRACKS = [
  { id: "tokyo",   label: "Tokyo Night Walk", src: "/music/tokyo-night-walk.mp3" },
  { id: "coffee",  label: "Chill Coffee",     src: "/music/chill-coffee.mp3" },
  { id: "moon",    label: "Moon Room",        src: "/music/moon-room.mp3" },
  { id: "focus",   label: "Focus Flow",       src: "/music/focus-flow.mp3" },
  { id: "workout", label: "Workout",          src: "/music/workout.mp3" },
];
const DURATIONS = [1, 2, 3, 5, 10, 15, 20, 30]; // minutes

function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.08;
    o.start();
    setTimeout(() => { o.frequency.value = 1320; }, 180);
    setTimeout(() => { o.stop(); ctx.close(); }, 420);
  } catch { /* */ }
}

export default function WhiteboardTimer({ boardId, dark }) {
  const [endsAt, setEndsAt] = useState(null);
  const [pausedRemaining, setPausedRemaining] = useState(null);
  const [lastDuration, setLastDuration] = useState(5 * 60);
  const [now, setNow] = useState(() => Date.now());
  const [trackId, setTrackId] = useState(null);
  const [muted, setMuted] = useState(false);
  const [menu, setMenu] = useState(null); // "length" | "music"
  const chanRef = useRef(null);
  const audioRef = useRef(null);
  const doneRef = useRef(false);

  const running = endsAt != null;
  const paused = pausedRemaining != null;
  const idle = !running && !paused;
  const remaining = running ? (endsAt - now) / 1000 : paused ? pausedRemaining : lastDuration;
  const finished = running && remaining <= 0;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (finished && !doneRef.current) { doneRef.current = true; beep(); }
    if (!finished && remaining > 0.5) doneRef.current = false;
  }, [finished, remaining]);

  // Shared timer + music-track state on a board-scoped channel.
  const applyState = useCallback((p, fromPeer) => {
    setEndsAt(p.endsAt ?? null);
    setPausedRemaining(p.pausedRemaining ?? null);
    if (p.lastDuration) setLastDuration(p.lastDuration);
    if ("trackId" in p) setTrackId(p.trackId ?? null);
    setNow(Date.now());
    doneRef.current = false;
    if (!fromPeer) {
      const ch = chanRef.current;
      if (ch) { try { ch.send({ type: "broadcast", event: "timer", payload: p }); } catch { /* */ } }
    }
  }, []);

  useEffect(() => {
    if (!boardId) return;
    const ch = supabase.channel(`wbtimer:${boardId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "timer" }, (msg) => applyState(msg.payload || {}, true));
    ch.subscribe();
    chanRef.current = ch;
    return () => { try { supabase.removeChannel(ch); } catch { /* */ } chanRef.current = null; };
  }, [boardId, applyState]);

  // Music follows the timer: loops while running (unless this person muted).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const track = TRACKS.find((t) => t.id === trackId);
    if (!track) { a.pause(); return; }
    if (a.getAttribute("src") !== track.src) a.src = track.src;
    a.volume = 0.4;
    if (running && !muted) a.play().catch(() => { /* autoplay blocked until a gesture */ });
    else a.pause();
  }, [trackId, running, muted]);

  const base = { lastDuration, trackId };
  const start = useCallback(() => applyState({ ...base, endsAt: Date.now() + lastDuration * 1000, pausedRemaining: null }), [applyState, lastDuration, trackId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pause = useCallback(() => applyState({ ...base, endsAt: null, pausedRemaining: Math.max(0, (endsAt - Date.now()) / 1000) }), [applyState, endsAt, lastDuration, trackId]); // eslint-disable-line react-hooks/exhaustive-deps
  const resume = useCallback(() => applyState({ ...base, endsAt: Date.now() + pausedRemaining * 1000, pausedRemaining: null }), [applyState, pausedRemaining, lastDuration, trackId]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = useCallback(() => applyState({ ...base, endsAt: null, pausedRemaining: null }), [applyState, lastDuration, trackId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickTrack = useCallback((id) => { applyState({ endsAt, pausedRemaining, lastDuration, trackId: id }); setMenu(null); }, [applyState, endsAt, pausedRemaining, lastDuration]);
  const onPrimary = running ? pause : paused ? resume : start;

  const surface = dark ? "#1e293b" : "#fff";
  const border = dark ? "#334155" : "#e2e8f0";
  const btn = `w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors ${
    dark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
  }`;
  const menuCls = `absolute top-9 z-20 p-1 rounded-xl border shadow-lg ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
  }`;
  const itemCls = (active) => `w-full text-left px-2.5 py-1 rounded-md text-[12px] font-medium ${
    active ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
      : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
  }`;

  return (
    <div
      className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl shadow-md pointer-events-auto"
      style={{ background: surface, border: `1px solid ${border}` }}
    >
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />}

      <TimerIcon className="w-4 h-4" style={{ color: finished ? "#ef4444" : "var(--color-accent)" }} />
      <span
        className="font-bold tabular-nums text-[17px] tracking-tight"
        style={{ color: finished ? "#ef4444" : dark ? "#f1f5f9" : "#0f172a", minWidth: 46, textAlign: "center" }}
      >
        {fmt(remaining)}
      </span>

      {idle && (
        <div className="relative z-20">
          <button
            type="button"
            onClick={() => setMenu(menu === "length" ? null : "length")}
            className={`h-7 px-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-0.5 ${dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {Math.round(lastDuration / 60)} min <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
          {menu === "length" && (
            <div className={`${menuCls} left-0 w-28`}>
              {DURATIONS.map((m) => (
                <button key={m} type="button" onClick={() => { setLastDuration(m * 60); setMenu(null); }} className={itemCls(lastDuration === m * 60)}>{m} min</button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onPrimary}
        title={running ? "Pause" : paused ? "Resume" : "Start"}
        className="w-8 h-8 rounded-full inline-flex items-center justify-center text-white shadow-sm"
        style={{ background: "var(--color-accent)" }}
      >
        {running ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
      </button>
      {!idle && (
        <button type="button" onClick={stop} className={btn} title="Stop"><Square className="w-4 h-4" /></button>
      )}

      <div className={`w-px h-5 mx-0.5 ${dark ? "bg-white/10" : "bg-slate-200"}`} />

      <div className="relative z-20">
        <button type="button" onClick={() => setMenu(menu === "music" ? null : "music")} className={btn} title="Music">
          <Music className="w-4 h-4" style={trackId && running && !muted ? { color: "var(--color-accent)" } : undefined} />
        </button>
        {menu === "music" && (
          <div className={`${menuCls} right-0 w-40`}>
            {TRACKS.map((t) => (
              <button key={t.id} type="button" onClick={() => pickTrack(t.id)} className={itemCls(trackId === t.id)}>{t.label}</button>
            ))}
            <button type="button" onClick={() => pickTrack(null)} className={itemCls(!trackId)}>No music</button>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setMuted((m) => !m)} className={btn} title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      <audio ref={audioRef} loop />
    </div>
  );
}
