import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { supabase } from "./supabase";
import AuthPage from "./AuthPage";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AppProvider, useApp } from "./context/AppContext";
import { TeamProvider } from "./context/TeamContext";
import { SyncSessionProvider, useSyncSession } from "./context/SyncSessionContext";
import { PomodoroProvider } from "./pomodoro/PomodoroContext";
import Nav from "./components/Nav";
import SettingsModal from "./components/SettingsModal";
import InvoiceModal from "./components/InvoiceModal";
import ClockBanner from "./components/ClockBanner";
import PomodoroTimer from "./components/PomodoroTimer";
import SyncSessionModal from "./components/SyncSessionModal";
import OnboardingModal from "./components/OnboardingModal";
import PWAUpdater from "./components/PWAUpdater";
import LogPage from "./pages/LogPage";
import OverviewPage from "./pages/OverviewPage";
import PlannerPage from "./pages/PlannerPage";
import TimeTrackerPage from "./pages/TimeTrackerPage";
import TeamPage from "./pages/TeamPage";
import TeamTimesheetsPage from "./pages/TeamTimesheetsPage";
import RetroPage from "./pages/RetroPage";
import RetrosListPage from "./pages/RetrosListPage";
import JoinRetroPage from "./pages/JoinRetroPage";
import PomodoroPage from "./pages/PomodoroPage";
import OfficePage from "./pages/OfficePage";
import JoinSyncPage from "./pages/JoinSyncPage";
import JoinTeamPage from "./pages/JoinTeamPage";
import AccountPage from "./pages/AccountPage";

function AppLayout({ session }) {
  const { theme } = useTheme();
  const darkMode = theme === "dark";
  const { settings, dataSyncing, clockIn, projects } = useApp();
  const { joinSession } = useSyncSession();
  const location = useLocation();

  useEffect(() => {
    const prevent = (e) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const onPomodoroPage = location.pathname.startsWith("/pomodoro");

  const currentTaskHint = (() => {
    if (!clockIn) return "";
    const projId = clockIn.projectIds?.[0];
    const proj = projId ? projects?.find((p) => p.id === projId)?.name : null;
    const desc = (clockIn.description || "").trim();
    if (proj && desc) return `${proj} — ${desc}`;
    if (proj) return proj;
    if (desc) return desc;
    return "";
  })();

  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const showOnboarding = !onboardingDismissed && !dataSyncing && !settings.name;

  function handleSessionJoined(sess) {
    joinSession(sess);
    setShowSyncModal(false);
    setShowPomodoro(true);
  }

  return (
    <div className={darkMode ? "dark" : ""}>
      <div className="relative min-h-screen w-full overflow-hidden transition-colors duration-300">
        {darkMode && (
          <div className="fixed inset-0 bg-slate-950 z-0">
            <div
              className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-gradient-to-br from-cyan-500/20 via-teal-500/15 to-transparent rounded-full blur-3xl animate-pulse"
              style={{ animationDuration: "8s" }}
            />
            <div
              className="absolute bottom-0 left-1/4 w-[700px] h-[700px] bg-gradient-to-br from-purple-500/15 via-pink-500/10 to-transparent rounded-full blur-3xl animate-pulse"
              style={{ animationDuration: "10s", animationDelay: "2s" }}
            />
            <div
              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-transparent rounded-full blur-3xl animate-pulse"
              style={{ animationDuration: "12s", animationDelay: "4s" }}
            />
            <div
              className="absolute inset-0 opacity-[0.015]"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
              }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
          </div>
        )}

        {!darkMode && (
          <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50/40 to-purple-50/40 z-0">
            <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-br from-blue-400/15 to-cyan-400/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-purple-400/10 to-pink-400/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
          </div>
        )}

        <div className="relative z-10 min-h-screen">
          <Nav onOpenPomodoro={() => setShowPomodoro(true)} />
          <SettingsModal />
          <InvoiceModal />
          <ClockBanner />
          {!onPomodoroPage && (
            <PomodoroTimer
              open={showPomodoro}
              onClose={() => setShowPomodoro(false)}
              userId={session.user.id}
              onOpenSync={() => setShowSyncModal(true)}
              currentTaskHint={currentTaskHint}
            />
          )}
          <SyncSessionModal
            open={showSyncModal}
            onClose={() => setShowSyncModal(false)}
            userId={session.user.id}
            displayName={settings?.name || ""}
            onSessionJoined={handleSessionJoined}
          />
          <OnboardingModal
            open={showOnboarding}
            onClose={() => setOnboardingDismissed(true)}
            userId={session.user.id}
          />
          <PWAUpdater />
          <Routes>
            <Route path="/" element={<LandingRedirector />} />
            {/* Legacy time-tracker URLs redirect into the unified page */}
            <Route path="/log" element={<Navigate to="/time-tracker/log" replace />} />
            <Route path="/overview" element={<Navigate to="/time-tracker/overview" replace />} />
            <Route path="/planner" element={<Navigate to="/time-tracker/planner" replace />} />
            <Route path="/time-tracker" element={<TimeTrackerPage />} />
            <Route path="/time-tracker/:tab" element={<TimeTrackerPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/timesheets" element={<TeamTimesheetsPage />} />
            {/* Retros section. /team/retro is the legacy URL — redirect. */}
            <Route path="/team/retro" element={<Navigate to="/retros" replace />} />
            <Route path="/retros" element={<RetrosListPage />} />
            <Route path="/retros/:retroId" element={<RetroPage />} />
            <Route
              path="/pomodoro"
              element={<PomodoroPage session={session} onOpenSync={() => setShowSyncModal(true)} />}
            />
            <Route path="/office" element={<OfficePage />} />
            <Route path="/account" element={<AccountPage session={session} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

// Reads the user's preferred landing page and redirects `/` there. Uses a
// localStorage cache so the redirect happens synchronously on initial
// render — without it, /log fans would briefly land on /pomodoro before
// the AppContext fetch completes and the redirect re-fires.
function LandingRedirector() {
  let target = "/pomodoro";
  try {
    if (localStorage.getItem("ql_default_landing") === "log") target = "/log";
  } catch { /* ignore — Safari private mode etc. */ }
  return <Navigate to={target} replace />;
}

function AuthenticatedApp({ session }) {
  return (
    <AppProvider session={session}>
      <TeamProvider session={session}>
        <SyncSessionProvider session={session}>
          <PomodoroProvider userId={session.user.id}>
            <AppLayout session={session} />
          </PomodoroProvider>
        </SyncSessionProvider>
      </TeamProvider>
    </AppProvider>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--color-bg)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</span>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/pomodoro/join/:code" element={<JoinSyncPage />} />
          <Route path="/team/join/:code" element={<JoinTeamPage />} />
          <Route path="/retros/join/:code" element={<JoinRetroPage />} />
          <Route
            path="/*"
            element={session ? <AuthenticatedApp session={session} /> : <AuthPage />}
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
