import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, PictureInPicture2, Users, Link as LinkIcon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { getShareableBaseUrl } from "../../lib/platform";
import TimerClock from "./TimerClock";
import TimerControls from "./TimerControls";
import ModePicker from "./ModePicker";
import SyncPanel from "./SyncPanel";
import SoundPicker from "./SoundPicker";
import SessionDots from "./SessionDots";
import PendingActionBanner from "./PendingActionBanner";
import MeetingCountdown from "./MeetingCountdown";
import { useTimerTitleAndBadge } from "./useTimerTitleAndBadge";
import {
  cloneDocStyles,
  PipFace,
  ReconnectingPill,
  PIP_VIEW_SIZES,
  PIP_CONFIRM_EXTRA_H,
} from "./PomodoroPipParts";

// One pomodoro surface, four variants. Each variant decides which
// composables to render and what chrome wraps them. Adding a new
// surface is a matter of adding a row to this object instead of
// threading another prop through a 1000-line monolith.
//
//   page     — /pomodoro: everything visible, large clock, full sync
//              panel with the participant list, sound picker, dots.
//   floating — the bottom-right overlay: same content as page but in
//              a fixed-position card with a Close button.
//   rail     — embedded in the office room view: compact, full mode
//              + clock + controls + status. Compact sync panel
//              (status only, no participant list).
//   popover  — Electron menubar popover: smallest density. Mode +
//              clock + controls + status. No sound, no PiP.
//
// The variant only configures composition. The pieces themselves are
// the same across surfaces, so a bug fixed in TimerControls fixes it
// everywhere.
const VARIANT_CONFIG = {
  page: {
    clockSize: "lg",
    showHeader: true,
    showCloseBtn: false,
    showSyncBtn: true,
    showPopoutBtn: true,
    showSyncPanel: true,
    syncParticipants: true,
    showModePicker: true,
    showControls: true,
    allowDurationEdit: true,
    showSoundPicker: true,
    showSessionDots: true,
    container: "embedded",
  },
  floating: {
    clockSize: "md",
    showHeader: true,
    showCloseBtn: true,
    showSyncBtn: true,
    showPopoutBtn: true,
    showSyncPanel: true,
    syncParticipants: true,
    showModePicker: true,
    showControls: true,
    allowDurationEdit: true,
    showSoundPicker: true,
    showSessionDots: true,
    container: "floating",
  },
  rail: {
    clockSize: "md",
    showHeader: true,
    showCloseBtn: false,
    showSyncBtn: false,
    showPopoutBtn: false,
    showSyncPanel: true,
    syncParticipants: false,
    showModePicker: true,
    showControls: true,
    allowDurationEdit: false,
    showSoundPicker: false,
    showSessionDots: false,
    container: "chromeless",
  },
  popover: {
    clockSize: "sm",
    showHeader: true,
    showCloseBtn: false,
    showSyncBtn: false,
    showPopoutBtn: false,
    showSyncPanel: true,
    syncParticipants: true,
    showModePicker: true,
    showControls: true,
    allowDurationEdit: false,
    showSoundPicker: true,
    showSessionDots: false,
    container: "chromeless",
  },
};

export default function PomodoroSurface({
  variant = "floating",
  open = true,
  onClose,
  onOpenSync,
  currentTaskHint,
}) {
  const cfg = VARIANT_CONFIG[variant] || VARIANT_CONFIG.floating;
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const { syncSession } = useSyncSession();
  const { isSynced, pendingAction, realtimeStatus } = usePomodoro();

  useTimerTitleAndBadge();

  // PiP wiring (full surfaces only).
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
    try { localStorage.setItem("ql_pip_view", pipViewMode); } catch { /* */ }
  }, [pipViewMode]);
  useEffect(() => {
    const pipWin = pipWinRef.current;
    if (!pipWin) return;
    const { w, h } = PIP_VIEW_SIZES[pipViewMode] || PIP_VIEW_SIZES.controls;
    const confirmExtra = pendingAction ? PIP_CONFIRM_EXTRA_H : 0;
    try { pipWin.resizeTo(w, h + confirmExtra); } catch { /* */ }
  }, [pipViewMode, pipMountEl, pendingAction]);
  useEffect(() => {
    const pipWin = pipWinRef.current;
    if (!pipWin?.document?.documentElement) return;
    pipWin.document.documentElement.classList.toggle("dark", dark);
  }, [dark, pipMountEl]);

  async function openPictureInPicture() {
    const dpi = typeof window !== "undefined" && window.documentPictureInPicture;
    if (!dpi?.requestWindow) return;
    try {
      const initial = PIP_VIEW_SIZES[pipViewMode] || PIP_VIEW_SIZES.controls;
      const pipWin = await dpi.requestWindow({
        width: initial.w,
        height: initial.h,
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
    } catch { /* user dismissed or unsupported */ }
  }

  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const controlsLocked = !!pendingAction;
  const userId = session?.user?.id;

  const containerCls = (() => {
    if (cfg.container === "embedded") {
      return `w-full rounded-2xl border ${
        dark
          ? "backdrop-blur-xl border-[var(--color-border)] bg-[var(--color-surface)]"
          : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
      }`;
    }
    if (cfg.container === "floating") {
      return `fixed bottom-3 right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-[60] sm:w-[22rem] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border shadow-2xl transition-all ${
        !open && !(controlsLocked && !pipMountEl) ? "hidden" : ""
      } ${
        dark
          ? "backdrop-blur-xl border-[var(--color-border)] bg-[var(--color-surface)]"
          : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
      }`;
    }
    return "w-full";
  })();

  // Pipface uses the existing PipParts; we keep that shape for now.
  const isInTransition = !!pendingAction;
  const { mode, isRunning, secondsLeft, durations, toggleRun, resetTimer, canControl,
          pendingMode, skipTransition, switchAlternateBreak, transferLeader, kickParticipant } = usePomodoro();
  const { syncParticipants, presenceMap } = useSyncSession();
  const transition = !!pendingMode;
  const displayMode = transition ? pendingMode : mode;
  const isBreakDisplay = displayMode !== "work";
  const total = transition ? 5 : durations[mode];
  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const startLabelText = isRunning ? "Pause" : secondsLeft < total ? "Resume" : "Start";
  const startBtnCls = isBreakDisplay
    ? "bg-[var(--color-break)] hover:bg-[var(--color-break-hover)] shadow-[var(--color-break)]/30"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] shadow-[var(--color-accent)]/30";
  const timeColor = isBreakDisplay ? "text-[var(--color-break)]" : "text-[var(--color-accent)]";
  const displayLabel = transition ? `${displayMode}…` : "";
  const showAlternateBreak = !transition && (mode === "shortBreak" || mode === "longBreak");
  const alternateBreakLabel = mode === "shortBreak"
    ? "Take long break instead"
    : "Take short break instead";

  return (
    <>
      <div className={containerCls}>
        {cfg.showHeader && (
          <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
            dark ? "border-[var(--color-border-light)]" : "border-slate-100"
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-xs font-semibold uppercase tracking-widest ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {isSynced ? "Sync" : "Pomodoro"}
              </span>
              {isSynced && syncSession && (
                <button
                  type="button"
                  onClick={() => {
                    const url = `${getShareableBaseUrl()}/pomodoro/join/${syncSession.join_code}`;
                    navigator.clipboard?.writeText(url);
                  }}
                  title="Copy invite link"
                  className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded transition-colors bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
                >
                  {syncSession.join_code}
                  <LinkIcon className="w-3 h-3 opacity-70" />
                </button>
              )}
              {isSynced && syncSession?.expires_at && (
                <MeetingCountdown
                  expiresAt={syncSession.expires_at}
                  sessionId={syncSession.id}
                  dark={dark}
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              {!isSynced && cfg.showSyncBtn && onOpenSync && (
                <button
                  type="button"
                  onClick={onOpenSync}
                  title="Sync with coworker"
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                    dark
                      ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]"
                      : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Sync
                </button>
              )}
              {pipSupported && cfg.showPopoutBtn && (
                <button
                  type="button"
                  onClick={openPictureInPicture}
                  title="Pop out — keep the timer on top of other windows"
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                    dark
                      ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]"
                      : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-100"
                  }`}
                >
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                  Pop out
                </button>
              )}
              {cfg.showCloseBtn && (
                <button
                  type="button"
                  onClick={onClose}
                  title="Close"
                  className={`p-1 rounded-md transition-colors ${
                    dark
                      ? "text-slate-500 hover:text-slate-300 hover:bg-[var(--color-surface-raised)]"
                      : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="px-4 pt-3 pb-4 space-y-4">
          {cfg.showSyncPanel && (
            <SyncPanel
              showParticipants={cfg.syncParticipants}
              currentTaskHint={currentTaskHint}
            />
          )}

          {cfg.showModePicker && <ModePicker size={cfg.clockSize === "sm" ? "sm" : "md"} />}

          {controlsLocked && <PendingActionBanner />}

          <div className="flex justify-center">
            <ReconnectingPill status={realtimeStatus} dark={dark} />
          </div>

          <TimerClock size={cfg.clockSize} />

          {cfg.showControls && (
            <TimerControls
              allowDurationEdit={cfg.allowDurationEdit}
            />
          )}

          {cfg.showSoundPicker && <SoundPicker />}
          {cfg.showSessionDots && <SessionDots />}
        </div>
      </div>

      {pipMountEl && createPortal(
        <PipFace
          mins={mins}
          secs={secs}
          modeLabel={displayLabel || mode}
          dark={dark}
          timeColor={timeColor}
          startBtnCls={startBtnCls}
          startLabel={startLabelText}
          timeSizeClass={pipViewMode === "timer" ? "text-5xl" : "text-4xl"}
          isRunning={isRunning}
          onToggleRun={toggleRun}
          onReset={resetTimer}
          canControl={canControl}
          controlsLocked={controlsLocked}
          isInTransition={!!pendingMode}
          onSkipTransition={skipTransition}
          showAlternateBreak={showAlternateBreak}
          alternateBreakLabel={alternateBreakLabel}
          onSwitchAlternateBreak={switchAlternateBreak}
          confirmProps={null}
          realtimeStatus={realtimeStatus}
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
