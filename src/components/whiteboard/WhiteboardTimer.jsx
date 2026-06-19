import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { supabase } from "../../supabase";

// A plain shared countdown for the board — "set 5 minutes while everyone
// writes their thoughts, then chat." Not the Pomodoro: no modes, no
// streak, no music. State is shared across everyone viewing the board via
// a board-scoped broadcast channel (absolute end-time, so all clients
// show the same number). Late joiners see it on the next start/pause.

const PRESETS = [1, 3, 5, 10]; // minutes

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
  const [endsAt, setEndsAt] = useState(null);              // ms — set while running
  const [pausedRemaining, setPausedRemaining] = useState(null); // sec — set while paused
  const [lastDuration, setLastDuration] = useState(5 * 60);     // sec — for display when idle
  const [now, setNow] = useState(() => Date.now());
  const chanRef = useRef(null);
  const doneRef = useRef(false);

  const running = endsAt != null;
  const paused = pausedRemaining != null;
  const remaining = running ? (endsAt - now) / 1000 : paused ? pausedRemaining : lastDuration;
  const finished = running && remaining <= 0;

  // Tick while running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  // Chime once when it hits zero.
  useEffect(() => {
    if (finished && !doneRef.current) { doneRef.current = true; beep(); }
    if (!finished && remaining > 0.5) doneRef.current = false;
  }, [finished, remaining]);

  // Shared state over a board-scoped channel.
  const applyState = useCallback((p, fromPeer) => {
    setEndsAt(p.endsAt ?? null);
    setPausedRemaining(p.pausedRemaining ?? null);
    if (p.lastDuration) setLastDuration(p.lastDuration);
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

  const start = useCallback((sec) => applyState({ endsAt: Date.now() + sec * 1000, pausedRemaining: null, lastDuration: sec }), [applyState]);
  const pause = useCallback(() => { if (running) applyState({ endsAt: null, pausedRemaining: Math.max(0, (endsAt - Date.now()) / 1000), lastDuration }); }, [applyState, running, endsAt, lastDuration]);
  const resume = useCallback(() => { if (paused) applyState({ endsAt: Date.now() + pausedRemaining * 1000, pausedRemaining: null, lastDuration }); }, [applyState, paused, pausedRemaining, lastDuration]);
  const reset = useCallback(() => applyState({ endsAt: null, pausedRemaining: null, lastDuration }), [applyState, lastDuration]);

  const idle = !running && !paused;
  const btn = `w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors ${
    dark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
  }`;
  const presetBtn = `px-1.5 h-6 rounded-md text-[11px] font-bold transition-colors ${
    dark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
  }`;

  return (
    <div
      className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl shadow-md pointer-events-auto"
      style={{ background: dark ? "#1e293b" : "#fff", border: `1px solid ${dark ? "#334155" : "#e2e8f0"}` }}
    >
      <TimerIcon className="w-4 h-4" style={{ color: finished ? "#ef4444" : "var(--color-accent)" }} />
      <span
        className="font-bold tabular-nums text-[17px] tracking-tight"
        style={{ color: finished ? "#ef4444" : dark ? "#f1f5f9" : "#0f172a", minWidth: 48, textAlign: "center" }}
        title="Shared countdown"
      >
        {fmt(remaining)}
      </span>

      {(idle || finished) && (
        <div className="flex items-center gap-0.5">
          {PRESETS.map((m) => (
            <button key={m} type="button" onClick={() => start(m * 60)} className={presetBtn} title={`${m} minute${m > 1 ? "s" : ""}`}>{m}m</button>
          ))}
        </div>
      )}
      {running && !finished && (
        <button type="button" onClick={pause} className={btn} title="Pause"><Pause className="w-4 h-4" /></button>
      )}
      {paused && (
        <button type="button" onClick={resume} className={btn} title="Resume"><Play className="w-4 h-4" /></button>
      )}
      {!idle && (
        <button type="button" onClick={reset} className={btn} title="Reset"><RotateCcw className="w-4 h-4" /></button>
      )}
    </div>
  );
}
