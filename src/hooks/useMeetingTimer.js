import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncSession } from "../context/SyncSessionContext";
import { findTrack } from "../lib/meetingTimerTracks";

const MUTE_KEY = "ql_meeting_timer_muted";
const VOLUME_KEY = "ql_meeting_timer_volume";

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
function writeMuted(v) {
  try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* */ }
}
function readVolume() {
  try {
    const n = parseFloat(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  } catch { /* */ }
  return 0.4;
}
function writeVolume(v) {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* */ }
}

// Reads the meeting-timer state off the active sync session, derives
// the live remaining-seconds countdown (re-evaluated each second), and
// owns the HTMLAudioElement that plays the chosen track.
//
// State shape returned:
//   status        — "idle" | "running" | "paused" | "done"
//   remaining     — integer seconds (clamped at 0)
//   duration      — total seconds for the current timer (null when idle)
//   track         — current track object (null if "none" or idle)
//   audioError    — boolean; true when audio failed to load (e.g. file missing)
//   muted         — local user toggle
//   setMuted(v)
//   volume        — 0..1
//   setVolume(v)
//
// The hook is read-only on the server. Start / Pause / Resume / Stop
// live on the lib/syncSession.js side — TimerWidget calls those.
export function useMeetingTimer() {
  const { syncSession } = useSyncSession();

  const startedAt = syncSession?.meeting_timer_started_at || null;
  const duration = syncSession?.meeting_timer_duration_seconds || null;
  const elapsedAtPause = syncSession?.meeting_timer_elapsed_at_pause_seconds || 0;
  const paused = !!syncSession?.meeting_timer_paused;
  const trackId = syncSession?.meeting_timer_track || null;
  const track = useMemo(() => findTrack(trackId), [trackId]);

  // Tick once per second while running so remaining-seconds re-renders.
  // We re-derive instead of storing in state so server updates win
  // over any local count.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || paused) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt, paused]);

  const startedAtMs = useMemo(
    () => (startedAt ? new Date(startedAt).getTime() : null),
    [startedAt]
  );

  let status = "idle";
  let remaining = 0;
  if (startedAtMs && duration) {
    const segmentElapsed = paused ? 0 : Math.max(0, Math.floor((now - startedAtMs) / 1000));
    const totalElapsed = elapsedAtPause + segmentElapsed;
    remaining = Math.max(0, duration - totalElapsed);
    if (paused) status = "paused";
    else if (remaining <= 0) status = "done";
    else status = "running";
  }

  // ── Audio ─────────────────────────────────────────────────────
  const audioRef = useRef(null);
  const [audioError, setAudioError] = useState(false);
  const [muted, setMutedState] = useState(readMuted);
  const [volume, setVolumeState] = useState(readVolume);

  const setMuted = (v) => { setMutedState(v); writeMuted(v); };
  const setVolume = (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    writeVolume(clamped);
  };

  // Mount / unmount the audio element when the track changes.
  useEffect(() => {
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch { /* */ }
      audioRef.current = null;
    }
    setAudioError(false);
    if (!track?.src) return;
    const el = new Audio(track.src);
    el.loop = true;
    el.preload = "auto";
    el.volume = muted ? 0 : volume;
    el.addEventListener("error", () => setAudioError(true));
    audioRef.current = el;
    return () => {
      try { el.pause(); } catch { /* */ }
      audioRef.current = null;
    };
    // Volume + muted are applied via the dedicated effects below so we
    // don't tear down the element on every slider tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.src]);

  // Reflect volume + muted onto the live element.
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  // Play when running, pause otherwise. play() returns a Promise that
  // rejects when no user gesture has happened yet — swallow that; the
  // user can tap the unmute / play affordance to retry.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (status === "running") {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => { /* gesture pending */ });
    } else {
      try { el.pause(); } catch { /* */ }
    }
  }, [status]);

  return {
    status, remaining, duration,
    track: track?.id === "none" ? null : track,
    audioError,
    muted, setMuted,
    volume, setVolume,
  };
}

export function formatRemaining(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
