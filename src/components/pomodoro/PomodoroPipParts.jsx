import { useEffect, useState } from "react";
import ConfirmRow from "../ConfirmRow";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import TimerClock from "./TimerClock";
import TimerControls from "./TimerControls";
import ModePicker from "./ModePicker";
import SessionDots from "./SessionDots";
import ParticipantCards from "./ParticipantCards";
import AlarmStopBanner from "./AlarmStopBanner";

/**
 * Renders a subtle "Reconnecting…" indicator when the Supabase Realtime
 * channel has been in a non-SUBSCRIBED state for >2 seconds. The grace
 * period swallows momentary blips (e.g., the brief CHANNEL_ERROR ↔
 * SUBSCRIBED flutter on tab focus) so the pill only surfaces when
 * something is actually wrong worth telling the user about. Hides
 * itself the moment we're back to SUBSCRIBED.
 */
export function ReconnectingPill({ status, dark, className = "" }) {
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (status === "SUBSCRIBED") {
      setShowing(false);
      return;
    }
    const id = setTimeout(() => setShowing(true), 2000);
    return () => clearTimeout(id);
  }, [status]);
  if (!showing) return null;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        dark
          ? "bg-amber-500/15 text-amber-300"
          : "bg-amber-500/10 text-amber-700"
      } ${className}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${
          dark ? "bg-amber-300" : "bg-amber-600"
        }`}
      />
      Reconnecting…
    </div>
  );
}

// Document-Picture-in-Picture window sizes per view. The popout resizes
// itself to these as the user flips views (see PomodoroSurface).
//   timer    — just the clock, glanceable
//   controls — clock + play/reset + mode tabs
//   full     — everything + the session roster (wider for names)
export const PIP_VIEW_SIZES = {
  timer: { w: 260, h: 190 },
  controls: { w: 260, h: 280 },
  full: { w: 360, h: 540 },
};

// No extra height reserved for a confirm prompt: the popout, like before,
// defers controller confirmations (reset / mode switch) to the main window.
export const PIP_CONFIRM_EXTRA_H = 0;

export function cloneDocStyles(targetDoc) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    try {
      targetDoc.head.appendChild(node.cloneNode(true));
    } catch {
      /* ignore */
    }
  });
}

// applyAccent writes the accent/break palette as inline custom properties on
// the main <html> (root.style.setProperty), which cloneDocStyles can't pick up
// (it only clones <style>/<link>). Mirror those onto the PiP document's root so
// the popout renders the user's actual accent — not the stylesheet default.
// Re-run on theme change since the palette differs between light and dark.
export function copyRootCustomProps(targetDoc) {
  const src = document.documentElement.style;
  const dst = targetDoc?.documentElement?.style;
  if (!dst) return;
  for (let i = 0; i < src.length; i++) {
    const prop = src[i];
    if (prop.startsWith("--")) {
      dst.setProperty(prop, src.getPropertyValue(prop), src.getPropertyPriority(prop));
    }
  }
}

// Outbound-action confirmation only. The previous "Use updated timer"
// remote-conflict prompt was removed in the server-authoritative
// migration (phase 1) — incoming remote rows are now applied silently.
// Kept here because PendingActionBanner imports it.
export function PomodoroConfirmPrompts({
  dark,
  pendingAction,
  outboundPrompt,
  outboundConfirmLabel,
  onConfirmOutbound,
  onCancelOutbound,
  className = "",
}) {
  if (!pendingAction) return null;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <ConfirmRow
        dark={dark}
        prompt={outboundPrompt}
        confirmLabel={outboundConfirmLabel}
        confirmTone={pendingAction.type === "reset" ? "danger" : "primary"}
        onConfirm={onConfirmOutbound}
        onCancel={onCancelOutbound}
      />
    </div>
  );
}

// Document-PiP face. Rebuilt on the shared modular timer components
// (TimerClock / TimerControls / ModePicker / SessionDots / ParticipantCards)
// so the popout matches the rest of the app and renders every timer state —
// focus, break, running, paused, resuming, mid-transition, follower-locked —
// exactly like the main surface, for free.
//
// Three views, switched by the segmented pill at the top:
//   timer    → big clock only
//   controls → clock + play/reset + Focus/Short/Long tabs
//   full     → all of the above + the live session roster
export function PipFace({ dark, viewMode, onViewModeChange }) {
  const { realtimeStatus } = usePomodoro();
  const compact = viewMode !== "full";

  const segBtn = (active) =>
    `flex-1 px-2 py-1 rounded-full text-[11px] font-semibold transition-all ${
      active
        ? "bg-[var(--color-accent)] text-white shadow-sm"
        : dark
          ? "text-slate-400 hover:text-slate-200"
          : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div
      className={`flex flex-col h-full w-full min-h-0 overflow-hidden ${
        dark ? "bg-[var(--color-surface)] text-slate-100" : "bg-white text-slate-800"
      }`}
    >
      {/* View switcher — app-style segmented pill (mirrors ModePicker) */}
      <div
        className={`shrink-0 m-2 inline-flex p-1 rounded-full ${
          dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
        }`}
      >
        <button type="button" onClick={() => onViewModeChange("timer")} className={segBtn(viewMode === "timer")}>
          Time
        </button>
        <button type="button" onClick={() => onViewModeChange("controls")} className={segBtn(viewMode === "controls")}>
          Controls
        </button>
        <button type="button" onClick={() => onViewModeChange("full")} className={segBtn(viewMode === "full")}>
          Users
        </button>
      </div>

      {/* Clock — modular TimerClock carries the mode colour + state label.
          Centered for the popout (the surface left-aligns it in its grid). */}
      <div
        className={`flex flex-col items-center justify-center gap-1.5 px-3 ${
          compact ? "flex-1" : "shrink-0 py-3"
        }`}
      >
        <div className="flex flex-col items-center">
          <TimerClock size={viewMode === "timer" ? "md" : "sm"} slot="numbers" />
          <TimerClock size="sm" slot="label" />
        </div>
        <SessionDots align="center" />
        <ReconnectingPill status={realtimeStatus} dark={dark} />
        <div className="w-full max-w-[220px]">
          <AlarmStopBanner />
        </div>
      </div>

      {/* Playback + mode switch — modular controls handle every state,
          including the follower lock and mid-transition "start now". */}
      {viewMode !== "timer" && (
        <div className="shrink-0 flex flex-col items-center gap-3 px-3 pb-3">
          <TimerControls size="sm" />
          <ModePicker />
        </div>
      )}

      {/* Session roster — the same ParticipantCards list the surface uses. */}
      {viewMode === "full" && (
        <div
          className={`flex-1 min-h-0 border-t px-3 py-2.5 overflow-y-auto ${
            dark ? "border-[var(--color-border)]" : "border-slate-200"
          }`}
        >
          <ParticipantCards max={8} />
        </div>
      )}
    </div>
  );
}
