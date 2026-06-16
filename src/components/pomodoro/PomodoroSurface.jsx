import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, PictureInPicture2, Users } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import TimerClock from "./TimerClock";
import TimerControls from "./TimerControls";
import ModePicker from "./ModePicker";
import LeaderActionBar from "./LeaderActionBar";
import SyncCodeRow from "./SyncCodeRow";
import StatusSetter from "./StatusSetter";
import SyncParticipantList from "../SyncParticipantList";
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

// One pomodoro surface, four variants. The variant config decides the
// container chrome (floating overlay vs embedded card) and the clock
// size; the body composition is otherwise shared.
//
//   page     — /pomodoro: large clock, full chrome
//   floating — bottom-right overlay: medium clock + Close button
//   rail     — office room view: medium clock, no PiP/Sound
//   popover  — Electron menubar: small clock, no PiP, no Sound
const VARIANT_CONFIG = {
  page:     { clockSize: "lg", showCloseBtn: false, showSyncBtn: true,  showPopoutBtn: true,  showSound: true,  showDots: true,  showParticipants: true,  container: "embedded"  },
  floating: { clockSize: "md", showCloseBtn: true,  showSyncBtn: true,  showPopoutBtn: true,  showSound: true,  showDots: true,  showParticipants: true,  container: "floating"  },
  rail:     { clockSize: "md", showCloseBtn: false, showSyncBtn: false, showPopoutBtn: false, showSound: false, showDots: true,  showParticipants: false, container: "chromeless" },
  popover:  { clockSize: "sm", showCloseBtn: false, showSyncBtn: false, showPopoutBtn: false, showSound: false, showDots: true,  showParticipants: true,  container: "chromeless" },
};

export default function PomodoroSurface({
  variant = "floating",
  open = true,
  onClose,
  onOpenSync,
}) {
  const cfg = VARIANT_CONFIG[variant] || VARIANT_CONFIG.floating;
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const { syncSession, takeControl } = useSyncSession();
  const {
    isSynced, pendingAction, realtimeStatus,
    mode, isRunning, secondsLeft, pendingMode, durations,
    toggleRun, resetTimer, skipTransition, switchAlternateBreak,
    canControl, transferLeader, kickParticipant,
  } = usePomodoro();
  const { syncParticipants, presenceMap } = useSyncSession();

  useTimerTitleAndBadge();

  // PiP wiring. PiP renders the existing PipFace component as a
  // portal into the document picture-in-picture window.
  const [pipMountEl, setPipMountEl] = useState(null);
  const pipWinRef = useRef(null);
  const [pipViewMode, setPipViewMode] = useState(() => {
    try { return localStorage.getItem("ql_pip_view") || "controls"; } catch { return "controls"; }
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
        width: initial.w, height: initial.h, disallowReturnToOpener: false,
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
      return `fixed bottom-3 right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-[60] sm:w-[24rem] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border shadow-2xl transition-all ${
        !open && !(controlsLocked && !pipMountEl) ? "hidden" : ""
      } ${
        dark
          ? "backdrop-blur-xl border-[var(--color-border)] bg-[var(--color-surface)]"
          : "bg-white/95 backdrop-blur-xl border-slate-200 shadow-slate-900/10"
      }`;
    }
    return "w-full";
  })();

  // Take-control handler for the inline "Take Leader" affordance.
  const takeLeaderHandler = isSynced && syncSession
    ? async () => { await takeControl(syncSession.id); }
    : null;

  // PiP-only props for the existing PipFace face.
  const safeSeconds = Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : 0;
  const mins = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const secs = String(safeSeconds % 60).padStart(2, "0");
  const isBreakDisplay = (pendingMode || mode) !== "work";
  const startLabelText = isRunning ? "Pause" : safeSeconds < (durations[mode] || 0) ? "Resume" : "Start";
  const startBtnCls = isBreakDisplay
    ? "bg-[var(--color-break)] hover:bg-[var(--color-break-hover)]"
    : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]";
  const timeColor = isBreakDisplay ? "text-[var(--color-break)]" : "text-[var(--color-accent)]";
  const showAlternateBreak = !pendingMode && (mode === "shortBreak" || mode === "longBreak");
  const alternateBreakLabel = mode === "shortBreak" ? "Take long break instead" : "Take short break instead";

  return (
    <>
      <div className={containerCls}>
        {/* Top utility bar — Sync / Pop out / Close. Doesn't render
            anything for the rail/popover variants; on those the wider
            UI handles those affordances elsewhere. */}
        {(cfg.showSyncBtn || cfg.showPopoutBtn || cfg.showCloseBtn) && (
          <div className={`flex items-center justify-between px-4 py-2 border-b ${
            dark ? "border-[var(--color-border-light)]" : "border-slate-100"
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              {/* Meeting countdown is urgent context — kept in the
                  top bar so it earns a glance even when scrolled. */}
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
                    dark ? "text-slate-400 hover:text-[var(--color-accent)]" : "text-slate-500 hover:text-[var(--color-accent)]"
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
                    dark ? "text-slate-400 hover:text-[var(--color-accent)]" : "text-slate-500 hover:text-[var(--color-accent)]"
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
                    dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="px-4 pt-3 pb-4 space-y-3">
          {/* Leader action bar — Leave / End Session at top of card */}
          <LeaderActionBar />

          {/* Mode picker — text + underline tabs */}
          <ModePicker />

          {/* Pending action confirm (mode switch, reset, etc.) */}
          {controlsLocked && <PendingActionBanner />}

          {/* Reconnecting pill — only renders when the realtime
              channel is unhealthy. SUBSCRIBED is the silent default. */}
          {realtimeStatus && realtimeStatus !== "SUBSCRIBED" && (
            <div className="flex justify-center">
              <ReconnectingPill status={realtimeStatus} dark={dark} />
            </div>
          )}

          {/* Hero row laid out as a 2-column grid so the play button is
              vertically anchored to the clock numerals (row 1), the
              small FOCUS / SHORT / LONG label sits beneath the numbers
              (row 2 left), and "Take Leader" / alt-break labels sit
              beneath the buttons (row 2 right). Without the grid the
              previous flex+items-end let the smaller right column
              float in the dead space between the numbers and the dots. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 items-center">
            <TimerClock size={cfg.clockSize} slot="numbers" />
            <TimerControls
              size={cfg.clockSize === "lg" ? "lg" : cfg.clockSize === "sm" ? "sm" : "md"}
              slot="buttons"
              onTakeLeader={takeLeaderHandler}
            />
            <TimerClock size={cfg.clockSize} slot="label" />
            <TimerControls
              size={cfg.clockSize === "lg" ? "lg" : cfg.clockSize === "sm" ? "sm" : "md"}
              slot="extras"
              onTakeLeader={takeLeaderHandler}
            />
            {cfg.showDots && (
              <div className="col-span-2 mt-1">
                <SessionDots />
              </div>
            )}
          </div>

          {/* Sync code + Share link row (synced only) */}
          <SyncCodeRow />

          {/* Status row + participants. Both rendered when synced;
              StatusSetter renders standalone outside sync too. */}
          {(isSynced || !isSynced) && <StatusSetter />}

          {isSynced && cfg.showParticipants && (syncParticipants?.length || 0) > 0 && (
            <SyncParticipantList
              participants={syncParticipants}
              leaderId={syncSession?.leader_id}
              controllerId={syncSession?.controller_id}
              presenceMap={presenceMap}
              currentUserId={userId}
              onTransferLeader={transferLeader}
              onKickParticipant={kickParticipant}
              onEditMyStatus={() => { /* StatusSetter is always-visible now */ }}
              defaultExpanded
            />
          )}

          {/* Sound section — collapsed by default, full surfaces only */}
          {cfg.showSound && <SoundPicker />}
        </div>
      </div>

      {pipMountEl && createPortal(
        <PipFace
          mins={mins}
          secs={secs}
          modeLabel={mode}
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
