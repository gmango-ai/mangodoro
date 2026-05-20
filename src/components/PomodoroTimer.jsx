import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../context/ThemeContext";
import { X, RotateCcw, PictureInPicture2, ChevronDown, ChevronUp, Users, LogOut, Copy } from "lucide-react";
import { supabase } from "../supabase";
import {
  loadPomodoroSoundSettings,
  savePomodoroSoundSettings,
  playCompletionSound,
} from "../lib/pomodoroSound";
import SyncParticipantList from "./SyncParticipantList";

const DURATIONS = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const MODE_LABELS = {
  work: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

const SOUND_PRESETS = [
  { id: "chime", label: "Chime" },
  { id: "beep", label: "Beep" },
  { id: "ding", label: "Ding" },
  { id: "bell", label: "Bell" },
];

function cloneDocStyles(targetDoc) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    try {
      targetDoc.head.appendChild(node.cloneNode(true));
    } catch {
      /* ignore */
    }
  });
}

function PipFace({
  mins,
  secs,
  modeLabel,
  onToggle,
  dark,
  timeColor,
  startBtnCls,
  startLabel,
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-4 min-h-[128px] rounded-xl border ${
        dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
      }`}
    >
      <span className={`text-3xl font-mono font-bold tabular-nums ${timeColor}`}>
        {mins}:{secs}
      </span>
      <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{modeLabel}</span>
      <button
        type="button"
        onClick={onToggle}
        className={`px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-md ${startBtnCls}`}
      >
        {startLabel}
      </button>
    </div>
  );
}

export default function PomodoroTimer({ open, onClose, userId, syncSession, syncParticipants, presenceMap, onOpenSync, onLeaveSync, onEndSync }) {
  const isSynced = !!syncSession;
  const isLeader = isSynced && syncSession.leader_id === userId;
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [mode, setMode] = useState("work");
  const [secondsLeft, setSecondsLeft] = useState(DURATIONS.work);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(0);

  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());
  const [soundOpen, setSoundOpen] = useState(false);
  const [pipMountEl, setPipMountEl] = useState(null);
  const pipWinRef = useRef(null);

  const modeRef = useRef(mode);
  const sessionsRef = useRef(sessions);
  modeRef.current = mode;
  sessionsRef.current = sessions;

  const soundRef = useRef(soundSettings);
  soundRef.current = soundSettings;

  const latestRef = useRef({ mode, sessions, isRunning, secondsLeft });
  latestRef.current = { mode, sessions, isRunning, secondsLeft };

  const endsAtMsRef = useRef(null);
  const suppressRemoteUntilRef = useRef(0);

  const flushToServer = useCallback(
    async (override = {}) => {
      if (!userId) return null;
      const base = latestRef.current;
      suppressRemoteUntilRef.current = Date.now() + 450;

      // Sync mode: write to sync_sessions (leader only)
      if (syncSession && syncSession.leader_id === userId) {
        const payload = {
          mode: override.mode ?? base.mode,
          sessions: override.sessions ?? base.sessions,
          is_running: override.is_running ?? base.isRunning,
          remaining_seconds: Math.max(0, override.remaining_seconds ?? base.secondsLeft),
        };
        const { data, error } = await supabase
          .from("sync_sessions")
          .update(payload)
          .eq("id", syncSession.id)
          .select()
          .single();
        if (error) { console.warn("sync session flush:", error.message); return null; }
        if (data?.ends_at) endsAtMsRef.current = new Date(data.ends_at).getTime();
        else endsAtMsRef.current = null;
        return data;
      }

      // Solo mode: write to user_pomodoro_state
      if (!syncSession) {
        const payload = {
          user_id: userId,
          mode: override.mode ?? base.mode,
          sessions: override.sessions ?? base.sessions,
          is_running: override.is_running ?? base.isRunning,
          remaining_seconds: Math.max(0, override.remaining_seconds ?? base.secondsLeft),
        };
        const { data, error } = await supabase
          .from("user_pomodoro_state")
          .upsert(payload, { onConflict: "user_id" })
          .select()
          .single();
        if (error) { console.warn("pomodoro sync:", error.message); return null; }
        if (data?.ends_at) endsAtMsRef.current = new Date(data.ends_at).getTime();
        else endsAtMsRef.current = null;
        return data;
      }

      return null; // participant in sync — no writes
    },
    [userId, syncSession]
  );

  const applyRemoteRow = useCallback((row) => {
    if (!row || Date.now() < suppressRemoteUntilRef.current) return;
    setMode(row.mode);
    setSessions(row.sessions);
    setIsRunning(row.is_running);
    if (row.is_running && row.ends_at) {
      endsAtMsRef.current = new Date(row.ends_at).getTime();
      setSecondsLeft(
        Math.max(0, Math.ceil((endsAtMsRef.current - Date.now()) / 1000))
      );
    } else {
      endsAtMsRef.current = null;
      setSecondsLeft(Math.max(0, row.remaining_seconds));
    }
  }, []);

  // Hydrate from server when logged in (solo mode)
  useEffect(() => {
    if (!userId || syncSession) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_pomodoro_state")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      suppressRemoteUntilRef.current = 0;
      applyRemoteRow(data);
      suppressRemoteUntilRef.current = Date.now() + 400;
    })();
    return () => { cancelled = true; };
  }, [userId, applyRemoteRow, syncSession]);

  // Hydrate from sync session
  useEffect(() => {
    if (!syncSession) return;
    suppressRemoteUntilRef.current = 0;
    applyRemoteRow(syncSession);
    suppressRemoteUntilRef.current = Date.now() + 400;
  }, [syncSession?.id]);

  // Realtime subscription — solo mode
  useEffect(() => {
    if (!userId || syncSession) return;
    const channel = supabase
      .channel(`pomodoro:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_pomodoro_state", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new;
          if (row && typeof row === "object") applyRemoteRow(row);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, applyRemoteRow, syncSession]);

  // Realtime subscription — sync mode
  useEffect(() => {
    if (!syncSession?.id) return;
    const channel = supabase
      .channel(`sync-session:${syncSession.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_sessions", filter: `id=eq.${syncSession.id}` },
        (payload) => {
          const row = payload.new;
          if (row && typeof row === "object") {
            if (row.status === "ended") {
              // session ended by leader
              onLeaveSync?.();
              return;
            }
            applyRemoteRow(row);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [syncSession?.id, applyRemoteRow, onLeaveSync]);

  // Countdown tick
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (userId && endsAtMsRef.current) {
          return Math.max(
            0,
            Math.ceil((endsAtMsRef.current - Date.now()) / 1000)
          );
        }
        return s <= 1 ? 0 : s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, userId]);

  // Completion
  useEffect(() => {
    if (!isRunning || secondsLeft > 0) return;
    setIsRunning(false);

    const currentMode = modeRef.current;
    const currentSessions = sessionsRef.current;

    playCompletionSound(soundRef.current);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(
        currentMode === "work"
          ? isSynced ? "Sync session: Time for a break!" : "Pomodoro done! Time for a break."
          : isSynced ? "Sync session: Break over — back to focus!" : "Break over — back to focus!",
        { icon: "/icon-192.png", tag: "pomodoro" }
      );
    }

    // In sync mode, only the leader writes the mode transition
    if (isSynced && !isLeader) return;

    if (currentMode === "work") {
      const next = currentSessions + 1;
      const nextMode = next % 4 === 0 ? "longBreak" : "shortBreak";
      const nextSecs = DURATIONS[nextMode];
      setSessions(next);
      setMode(nextMode);
      setSecondsLeft(nextSecs);
      endsAtMsRef.current = null;
      flushToServer({
        mode: nextMode,
        sessions: next,
        is_running: false,
        remaining_seconds: nextSecs,
      });
    } else {
      setMode("work");
      setSecondsLeft(DURATIONS.work);
      endsAtMsRef.current = null;
      flushToServer({
        mode: "work",
        sessions: currentSessions,
        is_running: false,
        remaining_seconds: DURATIONS.work,
      });
    }
  }, [secondsLeft, isRunning, flushToServer, isSynced, isLeader]);

  // Tab title
  useEffect(() => {
    const original = document.title;
    if (!isRunning) {
      document.title = original;
      return () => {
        document.title = original;
      };
    }
    const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
    const secs = String(secondsLeft % 60).padStart(2, "0");
    document.title = `${mins}:${secs} · QuestLogger`;
    return () => {
      document.title = original;
    };
  }, [isRunning, secondsLeft]);

  // PWA badge
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (isRunning) {
      const m = Math.floor(secondsLeft / 60);
      navigator.setAppBadge(m > 0 ? m : 1).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
    return () => {
      navigator.clearAppBadge?.().catch(() => {});
    };
  }, [isRunning, secondsLeft]);

  // PiP window theme class on html
  useEffect(() => {
    const pipWin = pipWinRef.current;
    if (!pipWin?.document?.documentElement) return;
    pipWin.document.documentElement.classList.toggle("dark", dark);
  }, [dark, pipMountEl]);

  async function openPictureInPicture() {
    const dpi = window.documentPictureInPicture;
    if (!dpi?.requestWindow) return;
    try {
      const pipWin = await dpi.requestWindow({
        width: 280,
        height: 168,
      });
      pipWinRef.current = pipWin;
      cloneDocStyles(pipWin.document);
      pipWin.document.body.style.margin = "0";
      pipWin.document.documentElement.classList.toggle("dark", dark);
      setPipMountEl(pipWin.document.body);
      pipWin.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        setPipMountEl(null);
      });
    } catch {
      /* user dismissed or unsupported */
    }
  }

  function updateSound(patch) {
    setSoundSettings((prev) => {
      const next = { ...prev, ...patch };
      savePomodoroSoundSettings(next);
      return next;
    });
  }

  const canControl = !isSynced || isLeader;

  function switchMode(newMode) {
    if (!canControl) return;
    const dur = DURATIONS[newMode];
    setMode(newMode);
    setSecondsLeft(dur);
    setIsRunning(false);
    endsAtMsRef.current = null;
    flushToServer({
      mode: newMode,
      remaining_seconds: dur,
      is_running: false,
    });
  }

  function reset() {
    if (!canControl) return;
    const dur = DURATIONS[mode];
    setSecondsLeft(dur);
    setIsRunning(false);
    endsAtMsRef.current = null;
    flushToServer({ remaining_seconds: dur, is_running: false });
  }

  async function toggleRun() {
    if (!canControl) return;
    if (!isRunning && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const willRun = !isRunning;
    setIsRunning(willRun);
    await flushToServer({
      is_running: willRun,
      remaining_seconds: secondsLeft,
    });
  }

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const total = DURATIONS[mode];
  const progress = secondsLeft === total ? 0 : (total - secondsLeft) / total;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const isBreak = mode !== "work";
  const accentHex = isBreak
    ? dark
      ? "#a78bfa"
      : "#9333ea"
    : dark
      ? "#06b6d4"
      : "#0d9488";
  const timeColor = isBreak
    ? dark
      ? "text-purple-400"
      : "text-purple-600"
    : dark
      ? "text-cyan-400"
      : "text-teal-600";
  const startBtnCls = isBreak
    ? dark
      ? "bg-purple-500 hover:bg-purple-400 shadow-purple-500/30"
      : "bg-purple-600 hover:bg-purple-500 shadow-purple-600/25"
    : dark
      ? "bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/30"
      : "bg-teal-600 hover:bg-teal-500 shadow-teal-600/25";

  const startLabel = isRunning ? "Pause" : secondsLeft < total ? "Resume" : "Start";

  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  return (
    <>
      <div
        className={`fixed bottom-6 right-6 z-[60] w-72 rounded-2xl border shadow-2xl transition-all ${
          !open ? "hidden" : ""
        } ${
          dark
            ? "bg-slate-900/95 backdrop-blur-xl border-slate-700/60"
            : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
        }`}
      >
        <div
          className={`flex items-center justify-between px-4 py-2.5 border-b ${
            dark ? "border-slate-700/50" : "border-slate-100"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold uppercase tracking-widest ${dark ? "text-slate-400" : "text-slate-500"}`}
            >
              {isSynced ? "Sync" : "Pomodoro"}
            </span>
            {isSynced && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                dark ? "bg-cyan-500/15 text-cyan-400" : "bg-teal-50 text-teal-600"
              }`}>
                {syncSession.join_code}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {!isSynced && (
              <button
                type="button"
                onClick={onOpenSync}
                title="Sync with coworker"
                className={`p-1 rounded-md transition-colors ${
                  dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            )}
            {pipSupported && (
              <button
                type="button"
                onClick={openPictureInPicture}
                title="Pop out timer"
                className={`p-1 rounded-md transition-colors ${
                  dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                dark
                  ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-4 space-y-4">
          {/* Sync participants */}
          {isSynced && syncParticipants?.length > 0 && (
            <div className="flex items-center justify-between">
              <SyncParticipantList
                participants={syncParticipants}
                leaderId={syncSession.leader_id}
                presenceMap={presenceMap}
              />
              <div className="flex gap-1">
                {isLeader ? (
                  <button
                    type="button"
                    onClick={onEndSync}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                      dark ? "text-red-400 hover:bg-red-500/15" : "text-red-500 hover:bg-red-50"
                    }`}
                  >
                    End
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onLeaveSync}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                      dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    <LogOut className="w-3 h-3 inline mr-0.5" /> Leave
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Not-leader hint */}
          {isSynced && !isLeader && (
            <p className={`text-center text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              The session leader controls the timer
            </p>
          )}

          <div className={`flex rounded-lg p-0.5 ${dark ? "bg-slate-800/60" : "bg-slate-100"}`}>
            {[
              ["work", "Focus"],
              ["shortBreak", "Short"],
              ["longBreak", "Long"],
            ].map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                disabled={!canControl}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  !canControl ? "cursor-default" : ""
                } ${
                  mode === m
                    ? dark
                      ? "bg-slate-700 text-white"
                      : "bg-white text-slate-800 shadow-sm"
                    : dark
                      ? "text-slate-500 hover:text-slate-300"
                      : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex justify-center">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="none"
                  strokeWidth="6"
                  className={dark ? "stroke-slate-800" : "stroke-slate-100"}
                />
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="none"
                  strokeWidth="6"
                  stroke={accentHex}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  style={{
                    transition: isRunning ? "stroke-dashoffset 1s linear" : "none",
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-1">
                <span className={`text-3xl font-mono font-bold tabular-nums leading-none ${timeColor}`}>
                  {mins}:{secs}
                </span>
                <span
                  className={`text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}
                >
                  {MODE_LABELS[mode]}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              disabled={!canControl}
              title="Reset"
              className={`p-2 rounded-full transition-colors ${
                !canControl ? "opacity-30 cursor-default" : ""
              } ${
                dark
                  ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleRun}
              disabled={!canControl}
              className={`px-7 py-2 rounded-full text-sm font-bold text-white shadow-lg transition-all ${
                !canControl ? "opacity-40 cursor-default" : ""
              } ${startBtnCls}`}
            >
              {startLabel}
            </button>
            <div className="w-8" />
          </div>

          <button
            type="button"
            onClick={() => setSoundOpen((v) => !v)}
            className={`flex items-center justify-center gap-1 w-full py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
              dark
                ? "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            Sound
            {soundOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {soundOpen && (
            <div
              className={`space-y-3 rounded-lg px-3 py-3 text-xs ${
                dark ? "bg-slate-800/50 border border-slate-700/60" : "bg-slate-50 border border-slate-100"
              }`}
            >
              <label className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                Preset
                <select
                  value={soundSettings.preset}
                  onChange={(e) => updateSound({ preset: e.target.value })}
                  className={`rounded-md border px-2 py-1.5 text-sm ${
                    dark
                      ? "bg-slate-900 border-slate-600 text-slate-200"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                >
                  {SOUND_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                Volume ({Math.round(soundSettings.volume * 100)}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(soundSettings.volume * 100)}
                  onChange={(e) =>
                    updateSound({ volume: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-teal-600"
                />
              </label>
              <label className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                Pitch ({soundSettings.pitch.toFixed(2)}×)
                <input
                  type="range"
                  min={50}
                  max={150}
                  value={Math.round(soundSettings.pitch * 100)}
                  onChange={(e) =>
                    updateSound({ pitch: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-teal-600"
                />
              </label>
              <button
                type="button"
                onClick={() => playCompletionSound(soundSettings)}
                className={`w-full py-1.5 rounded-md text-[11px] font-semibold ${
                  dark
                    ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Test sound
              </button>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < sessions % 4
                    ? dark
                      ? "bg-cyan-400"
                      : "bg-teal-500"
                    : dark
                      ? "bg-slate-700"
                      : "bg-slate-200"
                }`}
              />
            ))}
            <span
              className={`text-[11px] ml-1 font-mono ${dark ? "text-slate-500" : "text-slate-400"}`}
            >
              {sessions} {sessions === 1 ? "session" : "sessions"}
            </span>
          </div>
        </div>
      </div>

      {pipMountEl &&
        createPortal(
          <PipFace
            mins={mins}
            secs={secs}
            modeLabel={MODE_LABELS[mode]}
            onToggle={toggleRun}
            dark={dark}
            timeColor={timeColor}
            startBtnCls={startBtnCls}
            startLabel={startLabel}
          />,
          pipMountEl
        )}
    </>
  );
}
