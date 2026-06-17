// Cross-tree opener for the floating PomodoroSurface modal.
//
// The modal's open state lives in AppLayout (App.jsx) so it can render
// over any route. Components nested inside the office shell (room
// header chip, sidebar widget) need to open it without prop-drilling.
// We piggy-back on the same window-event pattern App.jsx already uses
// for "mangodoro:nav" → keeps the surface area small and avoids a
// dedicated context for a one-shot signal.

const EVENT = "mangodoro:open-pomodoro";

export function openPomodoroSurface() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const POMODORO_SURFACE_EVENT = EVENT;
