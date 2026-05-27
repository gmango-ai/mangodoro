import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { X, RotateCcw, PictureInPicture2, ChevronDown, ChevronUp, Users, LogOut, Copy, Pencil, Check, Link as LinkIcon, Lock, Unlock } from "lucide-react";
import { supabase } from "../supabase";
import {
  loadPomodoroSoundSettings,
  savePomodoroSoundSettings,
  playCompletionSound,
  stopCompletionSound,
  POMODORO_SOUND_PRESETS,
} from "../lib/pomodoroSound";
import { setBadge, clearBadge, formatTimerTitle } from "../lib/badge";
import { setSyncControlMode, setSyncVisibility } from "../lib/syncSession";
import SyncParticipantList from "./SyncParticipantList";

const DEFAULT_DURATIONS = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const DURATION_KEY = "ql_pomodoro_durations";

function loadStoredDurations() {
  try {
    const raw = localStorage.getItem(DURATION_KEY);
    if (!raw) return { ...DEFAULT_DURATIONS };
    const parsed = JSON.parse(raw);
    return {
      work: Number.isFinite(parsed.work) && parsed.work > 0 ? parsed.work : DEFAULT_DURATIONS.work,
      shortBreak: Number.isFinite(parsed.shortBreak) && parsed.shortBreak > 0 ? parsed.shortBreak : DEFAULT_DURATIONS.shortBreak,
      longBreak: Number.isFinite(parsed.longBreak) && parsed.longBreak > 0 ? parsed.longBreak : DEFAULT_DURATIONS.longBreak,
    };
  } catch { return { ...DEFAULT_DURATIONS }; }
}

function saveStoredDurations(d) {
  try { localStorage.setItem(DURATION_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

const MODE_LABELS = {
  work: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

const SOUND_CATEGORY_LABELS = {
  calm: "Calm",
  standard: "Standard",
  aggressive: "Aggressive / loud",
};

function cloneDocStyles(targetDoc) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    try {
      targetDoc.head.appendChild(node.cloneNode(true));
    } catch {
      /* ignore */
    }
  });
}

const PIP_VIEW_SIZES = {
  timer:    { w: 260, h: 220 },
  controls: { w: 320, h: 320 },
  full:     { w: 360, h: 520 },
};

const PIP_PRESENCE = {
  active:     { label: "Active",       light: "bg-emerald-500", dark: "bg-emerald-400" },
  available:  { label: "Available",    light: "bg-sky-500",     dark: "bg-sky-400"     },
  heads_down: { label: "Heads-down",   light: "bg-violet-500",  dark: "bg-violet-400"  },
  in_meeting: { label: "In a meeting", light: "bg-rose-500",    dark: "bg-rose-400"    },
  away:       { label: "Away",         light: "bg-amber-500",   dark: "bg-amber-400"   },
};

function PipAvatar({ participant, dark, isLeader }) {
  const url = participant.avatar_url;
  const initial = (participant.display_name || "?")[0].toUpperCase();
  return (
    <div
      className={`relative rounded-full overflow-hidden border shrink-0 ${
        isLeader
          ? dark ? "border-cyan-400" : "border-teal-500"
          : dark ? "border-slate-700" : "border-slate-300"
      }`}
      style={{ width: 28, height: 28 }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full text-[11px] font-bold ${
            isLeader
              ? dark ? "bg-cyan-500/30 text-cyan-300" : "bg-teal-100 text-teal-700"
              : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
          }`}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

function PipFace({
  // display
  mins, secs, modeLabel, dark, timeColor, startBtnCls, startLabel,
  // controls
  isRunning, onToggleRun, onReset, canControl,
  // view
  viewMode, onViewModeChange,
  // sync (for "full" view)
  syncSession, syncParticipants, presenceMap, currentUserId,
  onTransferLeader, onKickParticipant,
}) {
  const segBtn = (active) =>
    `flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-md transition-colors ${
      active
        ? dark ? "bg-cyan-500 text-white shadow" : "bg-teal-600 text-white shadow"
        : dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div
      className={`flex flex-col h-screen w-screen overflow-hidden ${
        dark ? "bg-slate-900 text-slate-100" : "bg-white text-slate-800"
      }`}
    >
      {/* 3-view toggle */}
      <div className={`flex gap-1 p-1 m-2 rounded-md ${dark ? "bg-slate-800/60" : "bg-slate-100"}`}>
        <button type="button" onClick={() => onViewModeChange("timer")}    className={segBtn(viewMode === "timer")}>Time</button>
        <button type="button" onClick={() => onViewModeChange("controls")} className={segBtn(viewMode === "controls")}>Controls</button>
        <button type="button" onClick={() => onViewModeChange("full")}     className={segBtn(viewMode === "full")}>Users</button>
      </div>

      {/* Timer face — always present. Inline style enforces tabular-nums
          even when the cloned PiP stylesheet hasn't fully applied
          Tailwind's utility, so each digit reserves the same width. */}
      <div className="flex-1 flex flex-col items-center justify-center gap-1 px-3">
        <span
          className={`text-5xl font-bold ${timeColor}`}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
            letterSpacing: "0.02em",
          }}
        >
          {mins}:{secs}
        </span>
        <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>{modeLabel}</span>
      </div>

      {/* Controls — shown in "controls" and "full" */}
      {viewMode !== "timer" && (
        <div className="flex items-center justify-center gap-2 pb-2 px-3">
          <button
            type="button"
            onClick={onReset}
            disabled={!canControl}
            title="Reset"
            className={`p-1.5 rounded-full ${
              !canControl ? "opacity-30 cursor-default" : ""
            } ${dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
            aria-label="Reset"
          >↺</button>
          <button
            type="button"
            onClick={onToggleRun}
            disabled={!canControl}
            className={`px-6 py-1.5 rounded-full text-xs font-bold text-white shadow-md ${
              !canControl ? "opacity-40 cursor-default" : ""
            } ${startBtnCls}`}
          >
            {startLabel}
          </button>
        </div>
      )}

      {/* Participants — shown only in "full". Each row is a fixed height
          (h-12) and the same internal layout so they line up cleanly. */}
      {viewMode === "full" && syncSession && (syncParticipants?.length > 0) && (
        <div className={`border-t px-2 py-2 overflow-y-auto ${dark ? "border-slate-700" : "border-slate-200"}`}>
          <ul className="space-y-1">
            {syncParticipants.map((p) => {
              const isLeader = p.user_id === syncSession.leader_id;
              const isSelf = p.user_id === currentUserId;
              const isOnline = presenceMap?.[p.user_id] ?? false;
              const presence = PIP_PRESENCE[p.presence_state] || PIP_PRESENCE.active;
              const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
              const subtitle = p.status?.trim()
                ? p.status
                : `${presence.label}${!isOnline ? " · Offline" : ""}`;
              const canModerate = !isSelf && !isLeader && syncSession.leader_id === currentUserId;
              return (
                <li
                  key={p.user_id}
                  className={`flex items-center gap-2 px-2 h-12 rounded ${dark ? "bg-slate-800/40" : "bg-slate-50"}`}
                >
                  <div className="relative">
                    <PipAvatar participant={p} dark={dark} isLeader={isLeader} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                        dark ? "border-slate-900" : "border-white"
                      } ${dotCls}`}
                      title={presence.label}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                      {isSelf ? `${p.display_name || "You"} (you)` : (p.display_name || "Member")}
                      {isLeader && <span className={`ml-1 ${dark ? "text-amber-300" : "text-amber-500"}`}>★</span>}
                    </p>
                    <p className={`text-[10px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {subtitle}
                    </p>
                  </div>
                  {canModerate && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {syncSession.control_mode === "leader" && (
                        <button
                          type="button"
                          onClick={() => onTransferLeader?.(p.user_id)}
                          title="Make leader"
                          className={`text-[11px] w-5 h-5 flex items-center justify-center rounded ${
                            dark ? "text-slate-400 hover:text-cyan-300 hover:bg-slate-700" : "text-slate-500 hover:text-teal-700 hover:bg-slate-200"
                          }`}
                        >★</button>
                      )}
                      <button
                        type="button"
                        onClick={() => onKickParticipant?.(p.user_id)}
                        title="Remove"
                        className={`text-[11px] w-5 h-5 flex items-center justify-center rounded ${
                          dark ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15" : "text-slate-500 hover:text-red-600 hover:bg-red-50"
                        }`}
                      >✕</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PomodoroTimer({
  open, onClose, userId, syncSession, syncParticipants, presenceMap,
  onOpenSync, onLeaveSync, onEndSync, onTransferLeader, onKickParticipant,
  onSetStatus, currentTaskHint,
  embedded = false,
  // When true, drop the rounded-2xl/border/bg card chrome so the timer
  // renders flat against the parent background (used by the popout).
  chromeless = false,
  // "full" | "controls" | "timer"
  //   full     = everything (default)
  //   controls = timer + mode tabs + start/pause/reset/edit + sync header
  //              (hides participants, status editor, sound, session dots)
  //   timer    = bare timer face only (hides everything but the circle)
  viewMode = "full",
}) {
  // Custom alarm sound URL (synced via user_settings). AppContext's
  // default is null when there's no provider, so this works both inside
  // and outside the layout (the popout mounts its own AppProvider).
  const appCtx = useApp();
  const customSoundUrl = appCtx?.settings?.pomodoroSoundUrl || "";
  const customSoundName = appCtx?.settings?.pomodoroSoundName || "";

  const isSynced = !!syncSession;
  const isLeader = isSynced && syncSession.leader_id === userId;
  const isOpenMode = isSynced && syncSession.control_mode === "open";
  const isParticipant = isSynced && Array.isArray(syncParticipants)
    && syncParticipants.some((p) => p.user_id === userId);
  const showFull = viewMode === "full";
  const showControls = viewMode === "controls" || viewMode === "full";
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [mode, setMode] = useState("work");
  const [durations, setDurations] = useState(() => loadStoredDurations());
  const [secondsLeft, setSecondsLeft] = useState(() => loadStoredDurations().work);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [editingDuration, setEditingDuration] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [statusEditing, setStatusEditing] = useState(false);

  const durationsRef = useRef(durations);
  durationsRef.current = durations;

  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());
  const [soundOpen, setSoundOpen] = useState(false);
  const [pipMountEl, setPipMountEl] = useState(null);
  const pipWinRef = useRef(null);
  const [pipViewMode, setPipViewMode] = useState(() => {
    try { return localStorage.getItem("ql_pip_view") || "controls"; } catch { return "controls"; }
  });
  useEffect(() => { try { localStorage.setItem("ql_pip_view", pipViewMode); } catch { /* ignore */ } }, [pipViewMode]);
  // Resize the PiP window whenever the view changes so it fits exactly.
  useEffect(() => {
    const pipWin = pipWinRef.current;
    if (!pipWin) return;
    const { w, h } = PIP_VIEW_SIZES[pipViewMode] || PIP_VIEW_SIZES.controls;
    try { pipWin.resizeTo(w, h); } catch { /* some implementations reject; ignore */ }
  }, [pipViewMode, pipMountEl]);

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
  // Unique-per-mount channel suffix so that two PomodoroTimer instances
  // (e.g. the floating panel in AppLayout AND the embedded one on the
  // dedicated /pomodoro page) don't collide on the same Supabase Realtime
  // channel name — supabase.channel() returns the same instance for a
  // repeated name, and calling `.on()` after `.subscribe()` throws.
  const channelSuffixRef = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const flushToServer = useCallback(
    async (override = {}) => {
      if (!userId) return null;
      const base = latestRef.current;
      suppressRemoteUntilRef.current = Date.now() + 450;

      // Sync mode: write to sync_sessions (leader, OR any active
      // participant when control_mode === 'open').
      const canWriteSync = syncSession && (
        syncSession.leader_id === userId
        || (syncSession.control_mode === "open"
            && (syncParticipants || []).some((p) => p.user_id === userId))
      );
      if (canWriteSync) {
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
    [userId, syncSession, syncParticipants]
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
      .channel(`pomodoro:${userId}:${channelSuffixRef.current}`)
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
      .channel(`sync-session:${syncSession.id}:${channelSuffixRef.current}`)
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

    playCompletionSound(soundRef.current, {
      event: currentMode === "work" ? "work" : "break",
      customSoundUrl,
    });

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(
        currentMode === "work"
          ? isSynced ? "Sync session: Time for a break!" : "Pomodoro done! Time for a break."
          : isSynced ? "Sync session: Break over — back to focus!" : "Break over — back to focus!",
        { icon: "/icon-192.png", tag: "pomodoro" }
      );
    }

    // In sync mode, only the leader writes the mode transition when
    // control_mode is 'leader'. In 'open' mode anyone present can.
    if (isSynced && !isLeader && !isOpenMode) return;

    const d = durationsRef.current;
    if (currentMode === "work") {
      const next = currentSessions + 1;
      const nextMode = next % 4 === 0 ? "longBreak" : "shortBreak";
      const nextSecs = d[nextMode];
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
      setSecondsLeft(d.work);
      endsAtMsRef.current = null;
      flushToServer({
        mode: "work",
        sessions: currentSessions,
        is_running: false,
        remaining_seconds: d.work,
      });
    }
  }, [secondsLeft, isRunning, flushToServer, isSynced, isLeader]);

  // Tab title + macOS dock badge.
  // Honors a window-level marker so we only manage the title in one place
  // (the dedicated /pomodoro and /pomodoro/popout pages set this too).
  useEffect(() => {
    const baseTitle = "QuestLogger";
    if (isRunning) {
      const title = formatTimerTitle(secondsLeft, mode);
      if (title) document.title = `${title} · ${baseTitle}`;
      setBadge(Math.ceil(secondsLeft / 60));
    } else {
      document.title = baseTitle;
      clearBadge();
    }
    return () => {
      // Don't reset on every tick — only on unmount when not running.
      if (!isRunning) {
        document.title = baseTitle;
        clearBadge();
      }
    };
  }, [isRunning, secondsLeft, mode]);

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
      const initial = PIP_VIEW_SIZES[pipViewMode] || PIP_VIEW_SIZES.controls;
      const pipWin = await dpi.requestWindow({
        width: initial.w,
        height: initial.h,
        // Hint to the browser this is a fixed-purpose mini window.
        disallowReturnToOpener: false,
      });
      pipWinRef.current = pipWin;
      cloneDocStyles(pipWin.document);
      pipWin.document.body.style.margin = "0";
      pipWin.document.body.style.overflow = "hidden";
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

  const canControl = !isSynced || isLeader || (isOpenMode && isParticipant);

  function switchMode(newMode) {
    if (!canControl) return;
    const dur = durations[newMode];
    setMode(newMode);
    setSecondsLeft(dur);
    setIsRunning(false);
    endsAtMsRef.current = null;
    setEditingDuration(false);
    flushToServer({
      mode: newMode,
      remaining_seconds: dur,
      is_running: false,
    });
  }

  function reset() {
    if (!canControl) return;
    const dur = durations[mode];
    setSecondsLeft(dur);
    setIsRunning(false);
    endsAtMsRef.current = null;
    setEditingDuration(false);
    flushToServer({ remaining_seconds: dur, is_running: false });
  }

  function applyCustomDuration(minutesStr, persist) {
    if (!canControl) return;
    const m = parseFloat(minutesStr);
    if (!Number.isFinite(m) || m <= 0) return;
    const secs = Math.max(1, Math.round(m * 60));
    if (persist) {
      const next = { ...durations, [mode]: secs };
      setDurations(next);
      saveStoredDurations(next);
    } else {
      setDurations((prev) => ({ ...prev, [mode]: secs }));
    }
    setSecondsLeft(secs);
    setIsRunning(false);
    endsAtMsRef.current = null;
    setEditingDuration(false);
    flushToServer({ remaining_seconds: secs, is_running: false });
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

  const total = durations[mode];
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
        className={`${
          chromeless
            ? "w-full"
            : embedded
              ? `w-full rounded-2xl border ${
                  dark
                    ? "bg-slate-900/95 backdrop-blur-xl border-slate-700/60"
                    : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
                }`
              : `fixed bottom-3 right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-[60] sm:w-[22rem] max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border shadow-2xl transition-all ${
                  !open ? "hidden" : ""
                } ${
                  dark
                    ? "bg-slate-900/95 backdrop-blur-xl border-slate-700/60"
                    : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
                }`
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
          {/* Sync management — always render when synced and viewMode != "timer" */}
          {isSynced && showControls && (
            <div className={`rounded-lg border p-2.5 space-y-2 ${
              dark ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-50 border-slate-200"
            }`}>
              {/* Join code + invite link + buttons (visible to all) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    Code
                  </span>
                  <span className={`font-mono text-sm font-bold tracking-[0.2em] ${dark ? "text-cyan-300" : "text-teal-700"}`}>
                    {syncSession.join_code}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(syncSession.join_code)}
                    title="Copy code"
                    className={`p-1 rounded transition-colors ${
                      dark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-700" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/pomodoro/join/${syncSession.join_code}`;
                      navigator.clipboard?.writeText(url);
                    }}
                    title="Copy invite link"
                    className={`p-1 rounded transition-colors ${
                      dark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-700" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <LinkIcon className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onLeaveSync}
                    title={isLeader ? "Leave — leadership transfers automatically" : "Leave session"}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                      dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    <LogOut className="w-3 h-3 inline mr-0.5" /> Leave
                  </button>
                  {isLeader && (
                    <button
                      type="button"
                      onClick={onEndSync}
                      title="End session for everyone"
                      className={`text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                        dark ? "text-red-400 hover:bg-red-500/15" : "text-red-500 hover:bg-red-50"
                      }`}
                    >
                      End
                    </button>
                  )}
                </div>
              </div>

              {/* Leader-only: two simple toggles for session settings */}
              {isLeader && (
                <div className="flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={async () => {
                      const next = syncSession.visibility === "team" ? "invite_only" : "team";
                      await setSyncVisibility(syncSession.id, next);
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition-colors ${
                      syncSession.visibility === "team"
                        ? dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
                        : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                    }`}
                    title={syncSession.visibility === "team"
                      ? "Anyone on your team can see and join this session"
                      : "Only people with the invite link can join"}
                  >
                    {syncSession.visibility === "team" ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {syncSession.visibility === "team" ? "Open to team" : "Closed (invite only)"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = isOpenMode ? "leader" : "open";
                      await setSyncControlMode(syncSession.id, next);
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition-colors ${
                      isOpenMode
                        ? dark ? "bg-cyan-500/15 text-cyan-300" : "bg-teal-50 text-teal-700"
                        : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                    }`}
                    title={isOpenMode ? "Anyone in this session can start/stop the timer" : "Only the leader can start/stop the timer"}
                  >
                    {isOpenMode ? "Anyone controls" : "Leader controls"}
                  </button>
                </div>
              )}

              {/* Participants — hidden in "controls" view */}
              {showFull && syncParticipants?.length > 0 ? (
                <SyncParticipantList
                  participants={syncParticipants}
                  leaderId={syncSession.leader_id}
                  controlMode={syncSession.control_mode}
                  presenceMap={presenceMap}
                  currentUserId={userId}
                  onTransferLeader={onTransferLeader}
                  onKickParticipant={onKickParticipant}
                  onEditMyStatus={() => {
                    const me = syncParticipants?.find((p) => p.user_id === userId);
                    setStatusDraft(me?.status || "");
                    setStatusEditing(true);
                  }}
                />
              ) : (
                <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  Waiting for members to join…
                </p>
              )}

              {/* My status + presence — hidden in "controls" view */}
              {showFull && (() => {
                const me = syncParticipants?.find((p) => p.user_id === userId);
                const myStatus = me?.status || "";
                const myPresence = me?.presence_state || "active";
                const presenceOptions = [
                  { key: "active", label: "Active", color: dark ? "bg-emerald-400" : "bg-emerald-500" },
                  { key: "away", label: "Away", color: dark ? "bg-amber-400" : "bg-amber-500" },
                  { key: "in_meeting", label: "Meeting", color: dark ? "bg-rose-400" : "bg-rose-500" },
                ];
                if (statusEditing) {
                  return (
                    <div className={`rounded-md border p-2 space-y-2 ${
                      dark ? "bg-slate-900/40 border-slate-700/60" : "bg-white border-slate-200"
                    }`}>
                      <div className="flex gap-1">
                        {presenceOptions.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => onSetStatus?.({ presenceState: opt.key })}
                            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                              myPresence === opt.key
                                ? dark ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800 shadow-sm"
                                : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${opt.color}`} />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={statusDraft}
                        onChange={(e) => setStatusDraft(e.target.value)}
                        placeholder="What are you working on?"
                        maxLength={80}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { onSetStatus?.({ status: statusDraft }); setStatusEditing(false); }
                          if (e.key === "Escape") setStatusEditing(false);
                        }}
                        className={`w-full h-8 px-2 rounded-md border text-[11px] ${
                          dark
                            ? "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                            : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                        }`}
                      />
                      <div className="flex items-center gap-1">
                        {currentTaskHint && (
                          <button
                            type="button"
                            onClick={() => setStatusDraft(currentTaskHint)}
                            title="Use what you're clocked into"
                            className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                              dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            Use current task
                          </button>
                        )}
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setStatusEditing(false)}
                          className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                            dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          onClick={() => { onSetStatus?.({ status: statusDraft }); setStatusEditing(false); }}
                          className={`text-[10px] font-semibold px-2 py-1 rounded-md text-white ${startBtnCls}`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  );
                }
                const presence = presenceOptions.find((p) => p.key === myPresence) || presenceOptions[0];
                return (
                  <button
                    type="button"
                    onClick={() => { setStatusDraft(myStatus); setStatusEditing(true); }}
                    className={`w-full flex items-center gap-2 text-left text-[11px] px-2 py-1.5 rounded-md border transition-colors ${
                      dark
                        ? "bg-slate-900/40 border-slate-700/60 text-slate-300 hover:border-cyan-500/40"
                        : "bg-white border-slate-200 text-slate-700 hover:border-teal-300"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${presence.color}`} />
                    <span className={`shrink-0 font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>
                      {presence.label}
                    </span>
                    <span className="truncate">
                      {myStatus
                        ? <>· {myStatus}</>
                        : <span className={dark ? "text-slate-500 italic" : "text-slate-400 italic"}>+ add status</span>}
                    </span>
                  </button>
                );
              })()}

              {/* Hints */}
              {isLeader && syncParticipants?.length > 1 && (
                <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  Hover or tap a member's avatar to see what they're doing
                </p>
              )}
              {!isLeader && !isOpenMode && (
                <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  The session leader controls the timer
                </p>
              )}
              {!isLeader && isOpenMode && (
                <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  Anyone in this session can start, pause, or reset the timer
                </p>
              )}
            </div>
          )}

          {showControls && (
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
          )}

          <div className="flex justify-center">
            <div className="relative w-40 h-40">
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

          {showControls && (
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
            <button
              type="button"
              onClick={() => {
                if (!canControl) return;
                setDraftMinutes(String(Math.max(1, Math.round(durations[mode] / 60))));
                setEditingDuration((v) => !v);
              }}
              disabled={!canControl}
              title="Set duration"
              className={`p-2 rounded-full transition-colors ${
                !canControl ? "opacity-30 cursor-default" : ""
              } ${
                editingDuration
                  ? dark ? "text-cyan-300 bg-slate-800" : "text-teal-700 bg-slate-100"
                  : dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          )}

          {showControls && editingDuration && canControl && (
            <div className={`rounded-lg border p-2.5 space-y-2 ${
              dark ? "bg-slate-800/50 border-slate-700/60" : "bg-slate-50 border-slate-200"
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  Set {MODE_LABELS[mode]} length
                </span>
                <div className="flex gap-1">
                  {[5, 10, 15, 25, 45].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraftMinutes(String(m))}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                        dark ? "text-slate-400 hover:text-cyan-300 hover:bg-slate-700" : "text-slate-500 hover:text-teal-700 hover:bg-slate-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="240"
                  step="1"
                  value={draftMinutes}
                  onChange={(e) => setDraftMinutes(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyCustomDuration(draftMinutes, false);
                    if (e.key === "Escape") setEditingDuration(false);
                  }}
                  className={`flex-1 h-8 px-2 rounded-md border text-sm font-mono ${
                    dark
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
                <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>min</span>
                <button
                  type="button"
                  onClick={() => applyCustomDuration(draftMinutes, false)}
                  title="Apply to this cycle"
                  className={`h-8 px-3 rounded-md text-xs font-bold text-white ${startBtnCls}`}
                >
                  <Check className="w-3.5 h-3.5 inline" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => applyCustomDuration(draftMinutes, true)}
                className={`w-full text-[10px] font-semibold py-1 rounded transition-colors ${
                  dark ? "text-slate-400 hover:text-cyan-300 hover:bg-slate-700/50" : "text-slate-500 hover:text-teal-700 hover:bg-slate-200/60"
                }`}
              >
                Apply & save as default
              </button>
            </div>
          )}

          {showFull && (
          <>
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
              {[
                { field: "workEndPreset", label: "When focus ends", event: "work" },
                { field: "breakEndPreset", label: "When break ends", event: "break" },
              ].map(({ field, label, event }) => (
                <div key={field} className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                  <div className="flex items-center justify-between">
                    <span>{label}</span>
                    <button
                      type="button"
                      onClick={() => playCompletionSound(soundSettings, { event, customSoundUrl })}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        dark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Test
                    </button>
                  </div>
                  <select
                    value={soundSettings[field]}
                    onChange={(e) => updateSound({ [field]: e.target.value })}
                    className={`rounded-md border px-2 py-1.5 text-sm ${
                      dark
                        ? "bg-slate-900 border-slate-600 text-slate-200"
                        : "bg-white border-slate-200 text-slate-800"
                    }`}
                  >
                    {customSoundUrl && (
                      <optgroup label="Your upload">
                        <option value="custom">{customSoundName || "Custom sound"}</option>
                      </optgroup>
                    )}
                    {["calm", "standard", "aggressive"].map((cat) => (
                      <optgroup key={cat} label={SOUND_CATEGORY_LABELS[cat]}>
                        {POMODORO_SOUND_PRESETS.filter((p) => p.category === cat).map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}

              <label className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                Volume ({Math.round(soundSettings.volume * 100)}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(soundSettings.volume * 100)}
                  onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
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
                  onChange={(e) => updateSound({ pitch: Number(e.target.value) / 100 })}
                  className="w-full accent-teal-600"
                />
              </label>
              <label className={`flex flex-col gap-1 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                Repeat
                <select
                  value={soundSettings.repeat}
                  onChange={(e) => updateSound({ repeat: Number(e.target.value) })}
                  className={`rounded-md border px-2 py-1.5 text-sm ${
                    dark
                      ? "bg-slate-900 border-slate-600 text-slate-200"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                >
                  <option value={1}>Once</option>
                  <option value={2}>Twice</option>
                  <option value={3}>3 times</option>
                  <option value={5}>5 times</option>
                  <option value={0}>Until I dismiss it</option>
                </select>
              </label>
              <button
                type="button"
                onClick={stopCompletionSound}
                className={`w-full py-1.5 rounded-md text-[11px] font-semibold ${
                  dark
                    ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Stop sound
              </button>
            </div>
          )}
          </>
          )}

          {showFull && (
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
          )}
        </div>
      </div>

      {pipMountEl &&
        createPortal(
          <PipFace
            mins={mins}
            secs={secs}
            modeLabel={MODE_LABELS[mode]}
            dark={dark}
            timeColor={timeColor}
            startBtnCls={startBtnCls}
            startLabel={startLabel}
            isRunning={isRunning}
            onToggleRun={toggleRun}
            onReset={reset}
            canControl={canControl}
            viewMode={pipViewMode}
            onViewModeChange={setPipViewMode}
            syncSession={syncSession}
            syncParticipants={syncParticipants}
            presenceMap={presenceMap}
            currentUserId={userId}
            onTransferLeader={onTransferLeader}
            onKickParticipant={onKickParticipant}
          />,
          pipMountEl
        )}
    </>
  );
}
