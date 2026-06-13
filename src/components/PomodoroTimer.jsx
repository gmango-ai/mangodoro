import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import {
  MODE_LABELS,
  TRANSITION_SECONDS,
  WORK_SESSIONS_PER_CYCLE,
} from "../pomodoro/constants";
import { X, RotateCcw, PictureInPicture2, ChevronDown, ChevronUp, Users, LogOut, Copy, Pencil, Check, Link as LinkIcon, Lock, Unlock } from "lucide-react";
import {
  loadPomodoroSoundSettings,
  savePomodoroSoundSettings,
  playCompletionSound,
  stopCompletionSound,
  POMODORO_SOUND_PRESETS,
} from "../lib/pomodoroSound";
import { setBadge, clearBadge, formatTimerTitle } from "../lib/badge";
import { setSyncVisibility } from "../lib/syncSession";
import SyncParticipantList from "./SyncParticipantList";
import ConfirmRow from "./ConfirmRow";
import {
  cloneDocStyles,
  PipFace,
  PomodoroConfirmPrompts,
  PIP_VIEW_SIZES,
  PIP_CONFIRM_EXTRA_H,
} from "./pomodoro/PomodoroPipParts";

const SOUND_CATEGORY_LABELS = {
  calm: "Calm",
  standard: "Standard",
  aggressive: "Aggressive / loud",
};

export default function PomodoroTimer({
  open, onClose, userId,
  onOpenSync,
  currentTaskHint,
  embedded = false,
  chromeless = false,
  viewMode = "full",
}) {
  const appCtx = useApp();
  const customSoundUrl = appCtx?.settings?.pomodoroSoundUrl || "";
  const customSoundName = appCtx?.settings?.pomodoroSoundName || "";

  const {
    syncSession,
    syncParticipants,
    presenceMap,
    leaveSession,
    endSession,
    transferLeader,
    kickParticipant,
    setStatus,
    takeControl,
  } = useSyncSession();

  const {
    mode,
    secondsLeft,
    isRunning,
    sessions,
    pendingMode,
    durations,
    autoTransition,
    isSynced,
    isLeader,
    isController,
    canControl,
    pendingAction,
    pendingRemoteRow,
    toggleRun,
    resetTimer: requestReset,
    switchMode: requestSwitchMode,
    switchAlternateBreak,
    skipTransition,
    applyCustomDuration: requestApplyCustomDuration,
    setAutoTransition,
    confirmPendingAction,
    cancelPendingAction,
    confirmRemote,
    cancelRemote,
  } = usePomodoro();

  const isParticipant =
    isSynced &&
    Array.isArray(syncParticipants) &&
    syncParticipants.some((p) => p.user_id === userId);
  const showFull = viewMode === "full";
  const showControls = viewMode === "controls" || viewMode === "full";
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [editingDuration, setEditingDuration] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [statusEditing, setStatusEditing] = useState(false);
  const [pendingTakeControl, setPendingTakeControl] = useState(false);
  const [takeControlError, setTakeControlError] = useState("");

  const [soundSettings, setSoundSettings] = useState(() => loadPomodoroSoundSettings());
  const [soundOpen, setSoundOpen] = useState(false);
  const [pipMountEl, setPipMountEl] = useState(null);
  const pipWinRef = useRef(null);
  const [pipViewMode, setPipViewMode] = useState(() => {
    try {
      return localStorage.getItem("ql_pip_view") || "controls";
    } catch {
      return "controls";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ql_pip_view", pipViewMode);
    } catch {
      /* ignore */
    }
  }, [pipViewMode]);
  useEffect(() => {
    const pipWin = pipWinRef.current;
    if (!pipWin) return;
    const { w, h } = PIP_VIEW_SIZES[pipViewMode] || PIP_VIEW_SIZES.controls;
    const confirmExtra = pendingAction || pendingRemoteRow ? PIP_CONFIRM_EXTRA_H : 0;
    try {
      pipWin.resizeTo(w, h + confirmExtra);
    } catch {
      /* ignore */
    }
  }, [pipViewMode, pipMountEl, pendingAction, pendingRemoteRow]);

  useEffect(() => {
    setPendingTakeControl(false);
    setTakeControlError("");
  }, [syncSession?.controller_id]);

  // Tab title + macOS dock badge.
  // Honors a window-level marker so we only manage the title in one place
  // (the dedicated /pomodoro and /pomodoro/popout pages set this too).
  useEffect(() => {
    const baseTitle = "Mangodoro";
    const inTransition = !!pendingMode;
    if (isRunning) {
      const title = formatTimerTitle(secondsLeft, inTransition ? pendingMode : mode);
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
  }, [isRunning, secondsLeft, mode, pendingMode]);

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
      pipWin.document.documentElement.style.height = "100%";
      pipWin.document.body.style.height = "100%";
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

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const isInTransition = !!pendingMode;
  const displayMode = isInTransition ? pendingMode : mode;
  const total = isInTransition ? TRANSITION_SECONDS : durations[mode];
  const progress = isInTransition
    ? (TRANSITION_SECONDS - secondsLeft) / TRANSITION_SECONDS
    : secondsLeft === total ? 0 : (total - secondsLeft) / total;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const isBreak = displayMode !== "work";
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
    : "text-[var(--color-accent)]";
  const startBtnCls = isBreak
    ? dark
      ? "bg-purple-500 hover:bg-purple-400 shadow-purple-500/30"
      : "bg-purple-600 hover:bg-purple-500 shadow-purple-600/25"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] shadow-[var(--color-accent)]/30";

  const startLabel = isRunning ? "Pause" : secondsLeft < total ? "Resume" : "Start";
  const displayLabel = isInTransition
    ? `${MODE_LABELS[pendingMode]} in…`
    : MODE_LABELS[mode];
  const showAlternateBreak = !isInTransition && (mode === "shortBreak" || mode === "longBreak");
  const alternateBreakLabel = mode === "shortBreak"
    ? "Take long break instead"
    : mode === "longBreak"
      ? "Take short break instead"
      : "";

  const syncSuffix = isSynced ? " for everyone in this session." : ".";
  const controlsLocked = !!pendingAction || !!pendingRemoteRow || pendingTakeControl;

  async function confirmTakeControl() {
    if (!syncSession?.id) return;
    setTakeControlError("");
    const result = await takeControl(syncSession.id);
    if (result?.error) {
      setPendingTakeControl(false);
      setTakeControlError(result.error.message || "Could not take control");
      return;
    }
    setPendingTakeControl(false);
  }

  let outboundPrompt = "";
  let outboundConfirmLabel = "Confirm";
  if (pendingAction?.type === "switchMode") {
    outboundPrompt = `Switch to ${MODE_LABELS[pendingAction.newMode]}? This will stop the current timer${syncSuffix}`;
    outboundConfirmLabel = "Switch";
  } else if (pendingAction?.type === "reset") {
    outboundPrompt = `Reset the timer? Current progress will be lost${syncSuffix}`;
    outboundConfirmLabel = "Reset";
  } else if (pendingAction?.type === "applyCustomDuration") {
    outboundPrompt = `Change the duration? This will stop the current timer${syncSuffix}`;
    outboundConfirmLabel = "Apply";
  } else if (pendingAction?.type === "switchAlternateBreak") {
    outboundPrompt = `Switch to ${MODE_LABELS[pendingAction.newMode]}? Your focus streak will reset${syncSuffix}`;
    outboundConfirmLabel = "Switch";
  }

  const showConfirmInMain = controlsLocked && (embedded || open || !pipMountEl);
  const confirmProps = controlsLocked ? {
    dark,
    isSynced,
    pendingAction,
    pendingRemoteRow,
    outboundPrompt,
    outboundConfirmLabel,
    onConfirmOutbound: confirmPendingAction,
    onCancelOutbound: cancelPendingAction,
    onConfirmRemote: confirmRemote,
    onCancelRemote: cancelRemote,
  } : null;

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
              : `fixed bottom-3 right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-[60] sm:w-[22rem] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border shadow-2xl transition-all ${
                  !open && !(controlsLocked && !pipMountEl) ? "hidden" : ""
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
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-xs font-semibold uppercase tracking-widest ${dark ? "text-slate-400" : "text-slate-500"}`}
            >
              {isSynced ? "Sync" : "Pomodoro"}
            </span>
            {/* Share shortcut promoted into the header. Click → copy
                the join link. Was previously a small icon buried in
                the controls; clearer affordance up here. */}
            {isSynced && (
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/pomodoro/join/${syncSession.join_code}`;
                  navigator.clipboard?.writeText(url);
                }}
                title="Copy invite link"
                className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded transition-colors bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
              >
                {syncSession.join_code}
                <LinkIcon className="w-3 h-3 opacity-70" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!isSynced && (
              <button
                type="button"
                onClick={onOpenSync}
                title="Sync with coworker"
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                  dark
                    ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-800"
                    : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Sync
              </button>
            )}
            {pipSupported && (
              <button
                type="button"
                onClick={openPictureInPicture}
                title="Pop out — keep the timer on top of other windows"
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                  dark
                    ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-800"
                    : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
                }`}
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                Pop out
              </button>
            )}
            {/* Close button only makes sense for the floating overlay.
                On the dedicated /pomodoro page the timer IS the page;
                there's nothing to close into. */}
            {!embedded && (
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className={`p-1 rounded-md transition-colors ${
                  dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="px-4 pt-3 pb-4 space-y-4">
          {/* Sync management — always render when synced and viewMode != "timer" */}
          {isSynced && showControls && (
            <div className={`rounded-lg border p-2.5 space-y-2 ${
              dark ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-50 border-slate-200"
            }`}>
              {/* Leave / End row. The join code + copy-link affordance
                  lives in the header chip now (clicking it copies the
                  invite link) so we don't render the code twice. */}
              <div className="flex items-center justify-end gap-2 flex-wrap gap-y-1.5">
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={leaveSession}
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
                      onClick={endSession}
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

              {/* Leader-only: visibility toggle */}
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
                </div>
              )}

              {/* Participants — hidden in "controls" view */}
              {showFull && syncParticipants?.length > 0 ? (
                <SyncParticipantList
                  participants={syncParticipants}
                  leaderId={syncSession.leader_id}
                  controllerId={syncSession.controller_id}
                  presenceMap={presenceMap}
                  currentUserId={userId}
                  onTransferLeader={transferLeader}
                  onKickParticipant={kickParticipant}
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
                            onClick={() => setStatus?.({ presenceState: opt.key })}
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
                          if (e.key === "Enter") { setStatus?.({ status: statusDraft }); setStatusEditing(false); }
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
                          onClick={() => { setStatus?.({ status: statusDraft }); setStatusEditing(false); }}
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
                        ? "bg-slate-900/40 border-slate-700/60 text-slate-300 hover:border-[var(--color-accent)]"
                        : "bg-white border-slate-200 text-slate-700 hover:border-[var(--color-accent)]"
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
              {isSynced && isParticipant && !isController && !pendingTakeControl && (
                <button
                  type="button"
                  onClick={() => { setTakeControlError(""); setPendingTakeControl(true); }}
                  disabled={controlsLocked && !pendingTakeControl}
                  className={`w-full text-[11px] font-semibold px-2 py-1.5 rounded-md transition-colors ${
                    dark
                      ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
                      : "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
                  }`}
                >
                  Take control of timer
                </button>
              )}
              {pendingTakeControl && (
                <ConfirmRow
                  dark={dark}
                  prompt="Take control of the timer? Others will follow your start/pause/reset."
                  confirmLabel="Take control"
                  confirmTone="primary"
                  onConfirm={confirmTakeControl}
                  onCancel={() => { setPendingTakeControl(false); setTakeControlError(""); }}
                />
              )}
              {takeControlError && (
                <p className={`text-[11px] px-1 ${dark ? "text-red-400" : "text-red-600"}`}>
                  {takeControlError}
                </p>
              )}
              {isSynced && isParticipant && !isController && !pendingTakeControl && (
                <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {(() => {
                    const controller = syncParticipants?.find((p) => p.user_id === syncSession.controller_id);
                    const name = controller?.display_name || "Someone else";
                    return `${name} controls the timer`;
                  })()}
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
                onClick={() => requestSwitchMode(m)}
                disabled={!canControl || controlsLocked || isInTransition}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  !canControl || controlsLocked ? "cursor-default opacity-60" : ""
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

          {showControls && showConfirmInMain && confirmProps && (
            <PomodoroConfirmPrompts {...confirmProps} />
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
                  {displayLabel}
                </span>
              </div>
            </div>
          </div>

          {showControls && (
          <div className="flex flex-col items-center gap-2">
            {isInTransition ? (
              <button
                type="button"
                onClick={skipTransition}
                disabled={!canControl || controlsLocked}
                className={`px-7 py-2 rounded-full text-sm font-bold text-white shadow-lg transition-all ${
                  !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
                } ${startBtnCls}`}
              >
                Start now
              </button>
            ) : (
            <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={requestReset}
              disabled={!canControl || controlsLocked}
              title="Reset"
              className={`p-2 rounded-full transition-colors ${
                !canControl || controlsLocked ? "opacity-30 cursor-default" : ""
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
              disabled={!canControl || controlsLocked}
              className={`px-7 py-2 rounded-full text-sm font-bold text-white shadow-lg transition-all ${
                !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
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
              disabled={!canControl || controlsLocked}
              title="Set duration"
              className={`p-2 rounded-full transition-colors ${
                !canControl || controlsLocked ? "opacity-30 cursor-default" : ""
              } ${
                editingDuration
                  ? dark ? "text-[var(--color-accent)] bg-slate-800" : "text-[var(--color-accent)] bg-slate-100"
                  : dark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
            </div>
            )}
            {showAlternateBreak && (
              <button
                type="button"
                onClick={switchAlternateBreak}
                disabled={!canControl || controlsLocked || isInTransition}
                className={`text-[11px] font-semibold ${
                  !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
                } ${dark ? "text-purple-300 hover:text-purple-200" : "text-purple-600 hover:text-purple-700"}`}
              >
                {alternateBreakLabel}
              </button>
            )}
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
                        dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-700" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-200"
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
                    if (e.key === "Enter") requestApplyCustomDuration(draftMinutes, false);
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
                  onClick={() => requestApplyCustomDuration(draftMinutes, false)}
                  title="Apply to this cycle"
                  className={`h-8 px-3 rounded-md text-xs font-bold text-white ${startBtnCls}`}
                >
                  <Check className="w-3.5 h-3.5 inline" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => requestApplyCustomDuration(draftMinutes, true)}
                className={`w-full text-[10px] font-semibold py-1 rounded transition-colors ${
                  dark ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-700/50" : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-200/60"
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
              <label className={`flex items-center justify-between gap-2 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                <span>5-second countdown before breaks</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoTransition}
                  onClick={() => setAutoTransition(!autoTransition)}
                  className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
                    autoTransition
                      ? "bg-[var(--color-accent)]"
                      : dark ? "bg-slate-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      autoTransition ? "translate-x-4" : ""
                    }`}
                  />
                </button>
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
                  i < Math.min(sessions, WORK_SESSIONS_PER_CYCLE)
                    ? "bg-[var(--color-accent)]"
                    : dark
                      ? "bg-slate-700"
                      : "bg-slate-200"
                }`}
              />
            ))}
            <span
              className={`text-[11px] ml-1 font-mono ${dark ? "text-slate-500" : "text-slate-400"}`}
            >
              {Math.min(sessions, WORK_SESSIONS_PER_CYCLE)}/{WORK_SESSIONS_PER_CYCLE}
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
            modeLabel={displayLabel}
            dark={dark}
            timeColor={timeColor}
            startBtnCls={startBtnCls}
            startLabel={startLabel}
            timeSizeClass={pipViewMode === "timer" ? "text-5xl" : "text-4xl"}
            isRunning={isRunning}
            onToggleRun={toggleRun}
            onReset={requestReset}
            canControl={canControl}
            controlsLocked={controlsLocked}
            isInTransition={isInTransition}
            onSkipTransition={skipTransition}
            showAlternateBreak={showAlternateBreak}
            alternateBreakLabel={alternateBreakLabel}
            onSwitchAlternateBreak={switchAlternateBreak}
            confirmProps={confirmProps}
            viewMode={pipViewMode}
            onViewModeChange={setPipViewMode}
            syncSession={syncSession}
            syncParticipants={syncParticipants}
            presenceMap={presenceMap}
            currentUserId={userId}
            onTransferLeader={transferLeader}
            onKickParticipant={kickParticipant}
          />,
          pipMountEl
        )}
    </>
  );
}
