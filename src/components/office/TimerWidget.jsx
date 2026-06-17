import { useState } from "react";
import {
  Timer, Play, Pause, Square, Volume2, VolumeX, Music, Share2, MonitorStop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useMeetingTimer, formatRemaining } from "../../hooks/useMeetingTimer";
import { useShareMusic } from "../../hooks/useShareMusic";
import {
  TIMER_TRACKS, TIMER_DURATION_PRESETS,
} from "../../lib/meetingTimerTracks";
import {
  startMeetingTimer, pauseMeetingTimer, resumeMeetingTimer, stopMeetingTimer,
} from "../../lib/syncSession";

// Sidebar widget for the session-scoped meeting timer.
//   Not in session  → muted hint
//   Leader, idle    → duration + track picker → Start
//   Leader, running → MM:SS + Pause/Stop
//   Leader, paused  → MM:SS + Resume/Stop
//   Non-leader      → readonly MM:SS, plus local volume/mute controls
//
// Audio plays for everyone whose browser allowed it (most modern
// browsers require a prior user interaction with the tab; the first
// tap on Pause/Mute/Volume counts and unblocks the loop).
export default function TimerWidget({ dark }) {
  const { session } = useApp();
  const { syncSession } = useSyncSession();
  const t = useMeetingTimer();

  const userId = session?.user?.id;
  const inSession = !!syncSession;
  const isLeader = inSession && syncSession.leader_id === userId;

  const share = useShareMusic();
  const [shareHintDismissed, setShareHintDismissed] = useState(false);

  const [duration, setDuration] = useState(TIMER_DURATION_PRESETS[1].seconds);
  const [trackId, setTrackId] = useState(TIMER_TRACKS[1].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function handleShareClick() {
    setShareHintDismissed(true);
    share.share();
  }

  async function start() {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await startMeetingTimer(syncSession.id, duration, trackId);
    setBusy(false);
    if (e) setError(e.message || "Could not start timer");
  }
  async function pause() {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await pauseMeetingTimer(syncSession.id);
    setBusy(false);
    if (e) setError(e.message || "Could not pause");
  }
  async function resume() {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await resumeMeetingTimer(syncSession.id);
    setBusy(false);
    if (e) setError(e.message || "Could not resume");
  }
  async function stop() {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await stopMeetingTimer(syncSession.id);
    setBusy(false);
    if (e) setError(e.message || "Could not stop");
  }

  const idle = t.status === "idle";
  const running = t.status === "running";
  const paused = t.status === "paused";
  const done = t.status === "done";

  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center gap-1.5 px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <Timer className="w-3 h-3" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Timer</span>
      </header>

      <div className="px-3 pb-3 space-y-2">
        {!inSession && (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            Join a session to run a synced meeting timer.
          </p>
        )}

        {/* Big countdown — only when there's something to show. */}
        {inSession && !idle && (
          <div className="flex items-center justify-between">
            <div
              className={`text-3xl font-display font-bold tabular-nums tracking-tight ${
                done
                  ? "text-[var(--color-accent)]"
                  : dark ? "text-slate-100" : "text-slate-800"
              }`}
            >
              {formatRemaining(t.remaining)}
            </div>
            <span
              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                done
                  ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                  : paused
                    ? dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
                    : dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {done ? "Time" : paused ? "Paused" : "Live"}
            </span>
          </div>
        )}

        {/* Leader controls — idle gets the picker; running/paused get
            the transport buttons. */}
        {inSession && isLeader && idle && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1">
              {TIMER_DURATION_PRESETS.map((p) => {
                const active = p.seconds === duration;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDuration(p.seconds)}
                    className={`text-[11px] font-semibold py-1 rounded-md border transition-colors ${
                      active
                        ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                        : dark
                          ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-300 hover:text-slate-100"
                          : "bg-white border-slate-200 text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              Track
            </label>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className={`w-full text-xs px-2 py-1.5 rounded-md border ${
                dark
                  ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-200"
                  : "bg-white border-slate-200 text-slate-700"
              }`}
            >
              {TIMER_TRACKS.map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.label}</option>
              ))}
            </select>
            <Button onClick={start} disabled={busy} size="sm" className="w-full">
              <Play className="w-3.5 h-3.5 mr-1.5" /> Start
            </Button>
          </div>
        )}

        {inSession && isLeader && (running || paused || done) && (
          <div className="flex gap-1.5">
            {running && (
              <Button onClick={pause} disabled={busy} size="sm" variant="outline" className="flex-1">
                <Pause className="w-3.5 h-3.5 mr-1.5" /> Pause
              </Button>
            )}
            {paused && (
              <Button onClick={resume} disabled={busy} size="sm" className="flex-1">
                <Play className="w-3.5 h-3.5 mr-1.5" /> Resume
              </Button>
            )}
            <Button onClick={stop} disabled={busy} size="sm" variant="outline" className={running || paused ? "" : "flex-1"}>
              <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
            </Button>
          </div>
        )}

        {/* Non-leader explanation when idle. */}
        {inSession && !isLeader && idle && (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            The leader can start a synced timer with music for the whole session.
          </p>
        )}

        {/* Track + local audio controls — visible to anyone when a
            timer is active and a track is set. */}
        {inSession && !idle && t.track && (
          <div className={`flex items-center gap-2 pt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <button
              type="button"
              onClick={() => t.setMuted(!t.muted)}
              aria-label={t.muted ? "Unmute" : "Mute"}
              title={t.muted ? "Unmute" : "Mute"}
              className={`p-1 rounded-md transition-colors ${
                dark ? "hover:bg-[var(--color-surface)] hover:text-slate-200" : "hover:bg-white hover:text-slate-700"
              }`}
            >
              {t.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={t.muted ? 0 : t.volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (t.muted && v > 0) t.setMuted(false);
                t.setVolume(v);
              }}
              className="flex-1 accent-[var(--color-accent)]"
              aria-label="Timer music volume"
            />
            <span className="inline-flex items-center gap-1 text-[10px] truncate max-w-[80px]" title={t.track.label}>
              <Music className="w-3 h-3 shrink-0" />
              {t.track.label}
            </span>
          </div>
        )}

        {inSession && !idle && t.track && t.audioError && (
          <p className={`text-[10px] italic ${dark ? "text-amber-300" : "text-amber-600"}`}>
            Audio file missing — drop {t.track.src} into /public/music/
          </p>
        )}

        {/* Share music — pipes the user's selected browser tab audio
            (Spotify / YouTube Music / Apple Music Web / etc) into the
            room call via Jitsi's screen-share. Chrome/Edge required;
            on the picker, they must check "Share tab audio". Only
            available while the user is in the room call. */}
        {inSession && share.available && (
          <div className={`pt-2 mt-1 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
            {share.sharing ? (
              <Button
                onClick={share.stop}
                size="sm"
                variant="outline"
                className="w-full"
                title="Stop sharing your tab audio"
              >
                <MonitorStop className="w-3.5 h-3.5 mr-1.5" />
                Stop sharing music
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleShareClick}
                  size="sm"
                  variant="outline"
                  className="w-full"
                  title="Share a music tab's audio into the call"
                >
                  <Share2 className="w-3.5 h-3.5 mr-1.5" />
                  Share music tab
                </Button>
                {!shareHintDismissed && (
                  <p className={`text-[10px] leading-snug mt-1.5 ${dark ? "text-slate-500" : "text-slate-500"}`}>
                    Pick your music tab and <b>check "Share tab audio"</b>. Chrome / Edge only.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {error && (
          <p className={`text-[11px] font-medium ${dark ? "text-red-400" : "text-red-600"}`}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
