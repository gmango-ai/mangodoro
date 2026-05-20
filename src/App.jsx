import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { supabase } from "./supabase";
import AuthPage from "./AuthPage";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AppProvider, useApp } from "./context/AppContext";
import { TeamProvider } from "./context/TeamContext";
import Nav from "./components/Nav";
import SettingsModal from "./components/SettingsModal";
import InvoiceModal from "./components/InvoiceModal";
import ClockBanner from "./components/ClockBanner";
import PomodoroTimer from "./components/PomodoroTimer";
import SyncSessionModal from "./components/SyncSessionModal";
import LogPage from "./pages/LogPage";
import OverviewPage from "./pages/OverviewPage";
import PlannerPage from "./pages/PlannerPage";
import TeamPage from "./pages/TeamPage";
import TeamTimesheetsPage from "./pages/TeamTimesheetsPage";
import { leaveSyncSession, endSyncSession, fetchSyncParticipants } from "./lib/syncSession";

function AppLayout({ session }) {
  const { theme } = useTheme();
  const darkMode = theme === "dark";
  const { settings } = useApp();
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Sync pomodoro state
  const [syncSession, setSyncSession] = useState(null);
  const [syncParticipants, setSyncParticipants] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});

  // Rehydrate sync session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("ql_sync_session");
    if (!stored) return;
    try {
      const { sessionId } = JSON.parse(stored);
      if (!sessionId) return;
      supabase.from("sync_sessions").select("*").eq("id", sessionId).eq("status", "active").maybeSingle()
        .then(({ data }) => {
          if (data) {
            setSyncSession(data);
            fetchSyncParticipants(data.id).then(({ data: p }) => setSyncParticipants(p || []));
          } else {
            localStorage.removeItem("ql_sync_session");
          }
        });
    } catch { localStorage.removeItem("ql_sync_session"); }
  }, []);

  // Presence + participant subscription for sync session
  useEffect(() => {
    if (!syncSession?.id) return;
    const channel = supabase.channel(`sync-presence:${syncSession.id}`);

    // Presence
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const map = {};
      for (const key of Object.keys(state)) {
        for (const p of state[key]) { map[p.user_id] = true; }
      }
      setPresenceMap(map);
    });

    // Participant changes
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sync_session_participants", filter: `session_id=eq.${syncSession.id}` },
      () => { fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || [])); }
    );

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: session.user.id });
      }
    });

    return () => { supabase.removeChannel(channel); };
  }, [syncSession?.id, session.user.id]);

  function handleSessionJoined(sess) {
    setSyncSession(sess);
    setShowSyncModal(false);
    setShowPomodoro(true);
    localStorage.setItem("ql_sync_session", JSON.stringify({ sessionId: sess.id }));
    fetchSyncParticipants(sess.id).then(({ data: p }) => setSyncParticipants(p || []));
  }

  const handleLeaveSync = useCallback(async () => {
    if (syncSession) {
      await leaveSyncSession(syncSession.id, session.user.id);
    }
    setSyncSession(null);
    setSyncParticipants([]);
    setPresenceMap({});
    localStorage.removeItem("ql_sync_session");
  }, [syncSession, session.user.id]);

  async function handleEndSync() {
    if (syncSession) {
      await endSyncSession(syncSession.id);
    }
    setSyncSession(null);
    setSyncParticipants([]);
    setPresenceMap({});
    localStorage.removeItem("ql_sync_session");
  }

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="relative min-h-screen w-full overflow-hidden transition-colors duration-300">
        {/* Dark Mode Background */}
        {darkMode && (
          <div className="fixed inset-0 bg-slate-950 z-0">
            {/* Animated Gradient Orbs */}
            <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-gradient-to-br from-cyan-500/20 via-teal-500/15 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
            <div className="absolute bottom-0 left-1/4 w-[700px] h-[700px] bg-gradient-to-br from-purple-500/15 via-pink-500/10 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
            
            {/* Noise Texture Overlay */}
            <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
            
            {/* Grid Pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
          </div>
        )}

        {/* Light Mode Background */}
        {!darkMode && (
          <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50/40 to-purple-50/40 z-0">
            <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-br from-blue-400/15 to-cyan-400/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-purple-400/10 to-pink-400/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
          </div>
        )}

        {/* App content */}
        <div className="relative z-10 min-h-screen">
          <Nav onOpenPomodoro={() => setShowPomodoro(true)} />
          <SettingsModal />
          <InvoiceModal />
          <ClockBanner />
          <PomodoroTimer
            open={showPomodoro}
            onClose={() => setShowPomodoro(false)}
            userId={session.user.id}
            syncSession={syncSession}
            syncParticipants={syncParticipants}
            presenceMap={presenceMap}
            onOpenSync={() => setShowSyncModal(true)}
            onLeaveSync={handleLeaveSync}
            onEndSync={handleEndSync}
          />
          <SyncSessionModal
            open={showSyncModal}
            onClose={() => setShowSyncModal(false)}
            userId={session.user.id}
            displayName={settings?.name || ""}
            onSessionJoined={handleSessionJoined}
          />
          <Routes>
            <Route path="/" element={<LogPage />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/timesheets" element={<TeamTimesheetsPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--color-bg)" }}>
        <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</span>
      </div>
    );
  }

  if (!session) return <AuthPage />;

  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppProvider session={session}>
          <TeamProvider session={session}>
            <AppLayout session={session} />
          </TeamProvider>
        </AppProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
