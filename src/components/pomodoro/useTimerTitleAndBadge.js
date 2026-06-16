import { useEffect } from "react";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { setBadge, clearBadge, formatTimerTitle } from "../../lib/badge";

// Mounts the document.title + macOS dock badge effect exactly once
// regardless of how many surfaces the timer is rendered on. A window
// flag short-circuits subsequent mounts so the page, the rail, and the
// floating overlay don't fight over `document.title` if they happen
// to be mounted simultaneously.
//
// Surfaces that want title/badge ownership should call this hook;
// the second caller is a no-op until the first unmounts.
export function useTimerTitleAndBadge() {
  const { mode, secondsLeft, isRunning, pendingMode } = usePomodoro();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__mangodoroTimerTitleOwner) return;
    window.__mangodoroTimerTitleOwner = true;
    return () => { window.__mangodoroTimerTitleOwner = false; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only the surface that claimed ownership above runs the side
    // effect. This is a soft guard — if multiple surfaces mount on
    // the same tick the first wins and the others render UI but skip
    // the title/badge write.
    if (!window.__mangodoroTimerTitleOwner) return;
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
      if (!isRunning) {
        document.title = baseTitle;
        clearBadge();
      }
    };
  }, [isRunning, secondsLeft, mode, pendingMode]);
}
