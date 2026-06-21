import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { AppProvider } from "../context/AppContext";
import { TeamProvider } from "../context/TeamContext";
import { SyncSessionProvider } from "../context/SyncSessionContext";
import { PomodoroProvider } from "../pomodoro/PomodoroContext";
import { ThemeProvider } from "../context/ThemeContext";
import QuickActionsPopover from "./QuickActionsPopover";
import ErrorBoundary from "../components/ErrorBoundary";

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
      <div
        className="h-screen w-screen flex items-center justify-center text-center px-6 text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Sign in via the Mangodoro main window to use the menu bar timer.
      </div>
    );
  }
  return (
    <ErrorBoundary label="popover">
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
    </ErrorBoundary>
  );
}
