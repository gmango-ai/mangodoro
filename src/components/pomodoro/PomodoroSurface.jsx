import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Users, ChevronDown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import TimerClock from "./TimerClock";
import TimerControls from "./TimerControls";
import ModePicker from "./ModePicker";
import TeamIdentityHeader from "./TeamIdentityHeader";
import LeaderBadge from "./LeaderBadge";
import SyncCodeRow from "./SyncCodeRow";
import SoundDropdown from "./SoundDropdown";
import StatusSetter from "./StatusSetter";
import ParticipantCards from "./ParticipantCards";
import ActionButtonsBar from "./ActionButtonsBar";
import SessionDots from "./SessionDots";
import PendingActionBanner from "./PendingActionBanner";
import AlarmStopBanner from "./AlarmStopBanner";
import MeetingCountdown from "./MeetingCountdown";
import GoalsList from "../GoalsList";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import { useTimerTitleAndBadge } from "./useTimerTitleAndBadge";
import {
  cloneDocStyles,
  copyRootCustomProps,
  PipFace,
  ReconnectingPill,
  PIP_VIEW_SIZES,
  PIP_CONFIRM_EXTRA_H,
} from "./PomodoroPipParts";

// One pomodoro surface, four variants. Each variant config decides
// what optional sections render and the clock + button size class.
// The body composition itself is shared so a fix to (say) the play
// button shows up everywhere.
//
// Body order (top → bottom):
//   1. Header bar (TeamIdentityHeader + utility icons / close)
//   2. ModePicker (pill tabs)
//   3. Hero row (clock left, reset + play right, LeaderBadge below)
//   4. SyncCodeRow (when synced)
//   5. SoundDropdown (rendered conditionally per variant)
//   6. StatusSetter (presence dropdown + free-form text)
//   7. ParticipantCards (when synced, capped at variant.participantsMax)
//   8. ActionButtonsBar (when synced — Take Leader / Leave / End)
const VARIANT_CONFIG = {
  page: {
    clockSize: "lg", controlsSize: "lg",
    container: "embedded",
    showTeamHeader: true, headerInteractive: false,
    showPopout: true, showClose: false,
    showSound: true, participantsMax: 6,
    showGoals: false, // PomodoroPage already renders goals in its sidebar.
  },
  floating: {
    clockSize: "md", controlsSize: "md",
    container: "floating",
    showTeamHeader: true, headerInteractive: false,
    showPopout: true, showClose: true,
    showSound: true, participantsMax: 4,
    showGoals: true,
  },
  rail: {
    clockSize: "md", controlsSize: "md",
    container: "chromeless",
    showTeamHeader: false, headerInteractive: false,
    showPopout: false, showClose: false,
    showSound: false, participantsMax: 3,
    showGoals: false, // No room — rail variant is the tightest.
  },
  popover: {
    clockSize: "sm", controlsSize: "sm",
    container: "chromeless",
    // The menubar popover stays minimal: no org identity / pop-out button,
    // and everything from the sound picker down collapses behind a toggle so
    // the default view is just the timer.
    showTeamHeader: false, headerInteractive: false,
    showPopout: false, showClose: false,
    showSound: true, participantsMax: 3,
    showGoals: true, collapsibleExtras: true,
  },
};

export default function PomodoroSurface({
  variant = "floating",
  open = true,
  onClose,
  currentTaskHint = "",
}) {
  const cfg = VARIANT_CONFIG[variant] || VARIANT_CONFIG.floating;
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { syncSession } = useSyncSession();
  const { isSynced, pendingAction, realtimeStatus } = usePomodoro();
  const { goals: weekGoals } = useWeekGoals();

  useTimerTitleAndBadge();

  // Collapsed-by-default "extras" section (sound, status, goals, actions) for
  // variants with collapsibleExtras (the menubar popover).
  const [extrasOpen, setExtrasOpen] = useState(false);

  // PiP wiring.
  const [pipMountEl, setPipMountEl] = useState(null);
  const pipWinRef = useRef(null);
  // A pending confirmation force-shows the floating panel (so it can't be
  // missed, including when a synced follower receives one). That must not
  // trap the panel open: let the X dismiss it. Reset once the pending
  // action resolves so the next one re-surfaces the panel.
  const [pendingDismissed, setPendingDismissed] = useState(false);
  useEffect(() => {
    if (!pendingAction) setPendingDismissed(false);
  }, [pendingAction]);
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
    // The accent palette differs by theme — re-mirror it on every toggle.
    copyRootCustomProps(pipWin.document);
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
      copyRootCustomProps(pipWin.document);
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

  // Close the floating panel. Also marks the active pending confirmation
  // (if any) as dismissed so the force-show clause doesn't keep it open.
  function handleClose() {
    setPendingDismissed(true);
    onClose?.();
  }

  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const controlsLocked = !!pendingAction;

  const containerCls = (() => {
    if (cfg.container === "embedded") {
      return `w-full rounded-3xl border p-5 ${
        dark
          ? "border-[var(--color-border)] bg-[var(--color-surface)]"
          : "border-slate-200 bg-white shadow-sm"
      }`;
    }
    if (cfg.container === "floating") {
      // z-[160] keeps this floating panel above the persistent video
      // call (z-150 in PersistentVideoCall) so the PiP/stage no longer
      // bleeds over the timer, while staying below ESC-able modals (180+).
      return `fixed bottom-[calc(0.75rem+var(--bottom-inset))] right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-[160] sm:w-[26rem] max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-3xl border p-5 shadow-2xl transition-all ${
        !open && !(controlsLocked && !pipMountEl && !pendingDismissed) ? "hidden" : ""
      } ${
        dark
          ? "border-[var(--color-border)] bg-[var(--color-surface)]"
          : "border-slate-200 bg-white"
      }`;
    }
    return "w-full p-3";
  })();

  // Everything below the timer: sound picker, status setter, participants,
  // week goals, and the synced session action bar. Rendered inline for most
  // variants; tucked behind a collapsible toggle for collapsibleExtras ones.
  const extras = (
    <>
      {/* Sound dropdown (variant-gated) */}
      {cfg.showSound && <SoundDropdown />}

      {/* My status (always renders — works in and out of sync).
          currentTaskHint surfaces the "Use current task" button inside the
          editor when the user is clocked into something. */}
      <StatusSetter currentTaskHint={currentTaskHint} />

      {/* Participants */}
      <ParticipantCards max={cfg.participantsMax} />

      {/* Week goals — small banner showing the goals set in last week's
          retro that define this week's focus. Hidden when no goal was set. */}
      {cfg.showGoals && weekGoals.length > 0 && (
        <div
          className={`rounded-xl border p-3 ${
            dark
              ? "bg-[var(--color-surface-raised)]/40 border-[var(--color-border)]"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Current Goals
          </p>
          <GoalsList goals={weekGoals} dark={dark} compact />
        </div>
      )}

      {/* Bottom action bar (synced only) */}
      <ActionButtonsBar />
    </>
  );

  return (
    <>
      <div className={containerCls}>
        {/* Header — team identity on the left, utility icons on the right */}
        {(cfg.showTeamHeader || cfg.showPopout || cfg.showClose) && (
          <div className="flex items-start justify-between gap-3 mb-4">
            {cfg.showTeamHeader ? (
              <div className="min-w-0 flex-1">
                <TeamIdentityHeader interactive={cfg.headerInteractive} />
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                {isSynced && syncSession?.expires_at && (
                  <MeetingCountdown
                    expiresAt={syncSession.expires_at}
                    sessionId={syncSession.id}
                    dark={dark}
                  />
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 shrink-0">
              {pipSupported && cfg.showPopout && (
                <button
                  type="button"
                  onClick={openPictureInPicture}
                  title="Pop out"
                  className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors ${
                    dark
                      ? "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100"
                      : "border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
              {cfg.showClose && (
                <button
                  type="button"
                  onClick={handleClose}
                  title="Close"
                  className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors ${
                    dark
                      ? "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100"
                      : "border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Mode picker — pill tabs */}
          <ModePicker />

          {/* Pending action confirm */}
          {controlsLocked && <PendingActionBanner />}

          <AlarmStopBanner />

          {/* Reconnecting pill — only when realtime isn't healthy */}
          {realtimeStatus && realtimeStatus !== "SUBSCRIBED" && (
            <div className="flex justify-center">
              <ReconnectingPill status={realtimeStatus} dark={dark} />
            </div>
          )}

          {/* Hero row: clock left, reset + play right; leader-badge sits
              below the buttons on the right. Grid keeps the buttons
              vertically aligned with the time numerals. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-center">
            <TimerClock size={cfg.clockSize} slot="numbers" />
            <TimerControls size={cfg.controlsSize} />
            <div className="flex flex-col gap-1.5 min-w-0">
              <TimerClock size={cfg.clockSize} slot="label" />
              <SessionDots />
            </div>
            <div className="flex justify-end">
              <LeaderBadge />
            </div>
          </div>

          {/* Sync code (synced only) */}
          <SyncCodeRow />

          {/* Sound, status, participants, goals + session actions. On the
              popover these collapse behind a toggle so the default view is
              just the timer; other variants render them inline. */}
          {cfg.collapsibleExtras ? (
            <div className={`border-t pt-1 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
              <button
                type="button"
                onClick={() => setExtrasOpen((o) => !o)}
                aria-expanded={extrasOpen}
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  dark
                    ? "text-slate-400 hover:text-slate-200 hover:bg-[var(--color-surface-raised)]"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                {extrasOpen ? "Hide options" : "More options"}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${extrasOpen ? "rotate-180" : ""}`} />
              </button>
              {extrasOpen && <div className="space-y-4 pt-2">{extras}</div>}
            </div>
          ) : (
            extras
          )}
        </div>
      </div>

      {pipMountEl && createPortal(
        <PipFace
          dark={dark}
          viewMode={pipViewMode}
          onViewModeChange={setPipViewMode}
        />,
        pipMountEl
      )}
    </>
  );
}
