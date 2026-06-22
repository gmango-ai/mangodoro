import { useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "../supabase";
import { AppProvider } from "../context/AppContext";
import { TeamProvider } from "../context/TeamContext";
import { SyncSessionProvider } from "../context/SyncSessionContext";
import { PomodoroProvider } from "../pomodoro/PomodoroContext";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { applyAccent } from "../lib/accent";
import { LocalPomodoroProvider } from "../pomodoro/LocalPomodoroProvider";
import ModePicker from "../components/pomodoro/ModePicker";
import TimerClock from "../components/pomodoro/TimerClock";
import TimerControls from "../components/pomodoro/TimerControls";
import SessionDots from "../components/pomodoro/SessionDots";
import QuickActionsPopover from "./QuickActionsPopover";
import ErrorBoundary from "../components/ErrorBoundary";

// Signed-out menubar popover: a compact, no-account local timer (same shared
// components as the app) instead of a dead "sign in first" message. Mirrors the
// QuickActionsPopover chrome — applies the default accent, tracks the theme,
// and resizes the BrowserWindow to fit.
function PopoverLocalTimer() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const containerRef = useRef(null);

  useEffect(() => {
    applyAccent("teal", dark);
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const bridge = window.__electronPopover;
    if (!bridge?.resize) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      if (h > 0) bridge.resize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <LocalPomodoroProvider>
      <div
        ref={containerRef}
        className={`w-screen flex flex-col ${dark ? "bg-[#0f172a] text-slate-100" : "bg-white text-slate-800"}`}
        style={{ minHeight: "100%" }}
      >
        <div className="px-3 pt-3 pb-2 space-y-3">
          <ModePicker />
          <div className="flex flex-col items-center gap-2">
            <TimerClock size="md" slot="numbers" />
            <TimerClock size="sm" slot="label" />
            <SessionDots align="center" />
            <div className="mt-1">
              <TimerControls size="sm" />
            </div>
          </div>
        </div>
        <p className={`px-3 pb-3 text-center text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Local timer · sign in from the main window for sync &amp; teams.
        </p>
      </div>
    </LocalPomodoroProvider>
  );
}

/**
 * Top-level entry for the Electron menubar popover BrowserWindow.
 * Lives outside the React Router setup in App.jsx so route normalisation
 * by electron-serve can't accidentally land us on PomodoroPage. main.jsx
 * detects `?ui=popover` in window.location and renders this instead of
 * <App />.
 *
 * Mirrors the AuthenticatedApp provider stack but with no nav, no FAB,
 * no router. Session is restored from the shared localStorage that
 * Electron BrowserWindows share within the same session.
 */
export default function PopoverEntry() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        Loading…
      </div>
    );
  }
  if (!session) {
    return (
      <ThemeProvider>
        <PopoverLocalTimer />
      </ThemeProvider>
    );
  }
  return (
    <ErrorBoundary label="popover">
      {/* In-memory Router (not Browser) so shared components that use <Link> /
          useNavigate (e.g. GoalsList) have a Router context — without reading
          the electron-serve URL, which is why the popover avoided a real router. */}
      <MemoryRouter>
      <ThemeProvider>
        <AppProvider session={session}>
          <TeamProvider session={session}>
            <SyncSessionProvider session={session}>
              <PomodoroProvider userId={session.user.id}>
                <QuickActionsPopover />
              </PomodoroProvider>
            </SyncSessionProvider>
          </TeamProvider>
        </AppProvider>
      </ThemeProvider>
      </MemoryRouter>
    </ErrorBoundary>
  );
}
