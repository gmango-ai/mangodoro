import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Music2, Music } from "lucide-react";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import * as focusAudio from "../../lib/focusAudio";

// Hero focus-timer ribbon pinned over the canvas. Binds to the existing
// PomodoroContext (so the whole app — nav pill, pomodoro page, hero
// ribbon — stays in sync) and drives a procedural lo-fi loop when the
// timer is running with music armed.
//
// Music is purely a board-local opt-in: it doesn't add to the pomodoro
// context's own end-of-phase sounds. Users can mute or un-arm it
// without affecting the session timer.

const MODE_LABEL = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

function fmt(s) {
  const m = Math.floor((s ?? 0) / 60);
  const ss = Math.max(0, (s ?? 0) % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export default function HeroTimerRibbon({ channel = "lofi" }) {
  const {
    mode, secondsLeft, isRunning, durations,
    toggleRun, resetTimer, isSynced,
  } = usePomodoro();

  const [musicOn, setMusicOn] = useState(true);

  // Track the prior running state so we only call play() / stop() on
  // transitions, not on every render.
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = isRunning;
    if (wasRunning === isRunning) return;
    if (isRunning && musicOn) focusAudio.play(channel);
    else if (!isRunning) focusAudio.stop();
  }, [isRunning, musicOn, channel]);

  // When the user toggles music while the timer is running, start /
  // stop the loop immediately.
  useEffect(() => {
    if (!isRunning) return;
    if (musicOn) focusAudio.play(channel);
    else focusAudio.stop();
  }, [musicOn, channel, isRunning]);

  // Stop audio on unmount so navigating away kills the loop.
  useEffect(() => () => focusAudio.stop(), []);

  const total = durations?.[mode] ?? 1500;
  const frac = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;
  const deg = Math.round((1 - frac) * 360);

  const handleToggleRun = useCallback(() => {
    toggleRun?.();
  }, [toggleRun]);

  const handleReset = useCallback(() => {
    resetTimer?.();
    focusAudio.stop();
  }, [resetTimer]);

  return (
    <div
      className="flex items-center gap-3 pl-2.5 pr-3 py-2 rounded-2xl"
      style={{
        background: "rgba(255,251,245,.92)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(249,115,22,.25)",
        boxShadow: "0 16px 34px -18px rgba(120,80,20,.5)",
        pointerEvents: "auto",
      }}
    >
      <div
        className="relative w-12 h-12 rounded-full shrink-0 flex items-center justify-center"
        style={{
          background: `conic-gradient(#f97316 ${deg}deg, #fed7aa ${deg}deg)`,
        }}
      >
        <div
          className="absolute inset-[4px] rounded-full"
          style={{ background: "#FBF6EE" }}
        />
        {isRunning
          ? <Pause className="relative w-4 h-4" style={{ color: "#c2410c" }} />
          : <Play className="relative w-4 h-4" style={{ color: "#c2410c" }} />}
      </div>

      <div className="leading-none">
        <div
          className="font-extrabold tabular-nums tracking-tight"
          style={{ fontSize: 26, color: "#9a3412" }}
        >
          {fmt(secondsLeft)}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className="font-bold uppercase tracking-wider"
            style={{ fontSize: 8.5, color: "#c2410c" }}
          >
            {MODE_LABEL[mode] || "Focus"}
          </span>
          {isSynced && (
            <>
              <span className="w-[3px] h-[3px] rounded-full" style={{ background: "#fdba74" }} />
              <span
                className="font-bold uppercase tracking-wider"
                style={{ fontSize: 8.5, color: "rgba(60,40,10,.55)" }}
              >
                Synced
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 pl-1">
        <button
          type="button"
          onClick={handleToggleRun}
          title={isRunning ? "Pause" : "Start focus"}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
          style={{
            background: "#f97316",
            boxShadow: "0 6px 14px -6px rgba(249,115,22,.6)",
          }}
        >
          {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={handleReset}
          title="Reset"
          className="w-9 h-9 rounded-xl flex items-center justify-center border"
          style={{
            background: "var(--color-surface)",
            color: "var(--color-text-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMusicOn((v) => !v)}
          title={musicOn ? "Mute focus music" : "Play focus music"}
          aria-pressed={musicOn}
          className={`w-9 h-9 rounded-xl flex items-center justify-center border ${isRunning && musicOn ? "animate-pulse" : ""}`}
          style={{
            background: musicOn ? "#fff7ed" : "var(--color-surface)",
            color: musicOn ? "#c2410c" : "var(--color-text-secondary)",
            borderColor: musicOn ? "#fdba74" : "var(--color-border)",
          }}
        >
          {musicOn ? <Music2 className="w-4 h-4" /> : <Music className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
