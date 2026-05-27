import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
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
import OnboardingModal from "./components/OnboardingModal";
import PWAUpdater from "./components/PWAUpdater";
import LogPage from "./pages/LogPage";
import OverviewPage from "./pages/OverviewPage";
import PlannerPage from "./pages/PlannerPage";
import TeamPage from "./pages/TeamPage";
import TeamTimesheetsPage from "./pages/TeamTimesheetsPage";
import PomodoroPage from "./pages/PomodoroPage";
import JoinSyncPage from "./pages/JoinSyncPage";
import { leaveSyncSession, endSyncSession, fetchSyncParticipants, transferSyncLeader, kickSyncParticipant, setSyncParticipantStatus } from "./lib/syncSession";

function AppLayout({ session }) {
  const { theme } = useTheme();
  const darkMode = theme === "dark";
  const { settings, dataSyncing, clockIn, projects } = useApp();
  const location = useLocation();
  // The /pomodoro page renders its own embedded PomodoroTimer. Skip the
  // floating one on that route so two instances don't fight over the same
  // Supabase Realtime channel.
  const onPomodoroPage = location.pathname.startsWith("/pomodoro");

  // Suggest a status based on the user's current clock-in (project + description).
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

  // Show onboarding once on first login (no name set), after initial data load.
  const showOnboarding = !onboardingDismissed && !dataSyncing && !settings.name;

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
    const sessionId = syncSession.id;
    const refetch = async () => {
      // First, check our own row directly to see if we've been removed
      // (kicked, or we left from another tab). The "Read own participant
      // row" RLS policy (20260527170000) lets us read our row even when
      // left_at IS NOT NULL. If left_at is set, drop local state instead
      // of self-healing — otherwise the self-heal below would silently
      // re-join us right after a kick.
      const { data: myRow } = await supabase
        .from("sync_session_participants")
        .select("left_at")
        .eq("session_id", sessionId)
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (myRow?.left_at) {
        setSyncSession(null);
        setSyncParticipants([]);
        setPresenceMap({});
        localStorage.removeItem("ql_sync_session");
        try { new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" }); } catch { /* ignore */ }
        return;
      }

      const { data: p } = await fetchSyncParticipants(sessionId);
      const list = p || [];
      setSyncParticipants(list);
      // Self-heal: if I'm in this session but not in the participants list
      // AND there's no `left_at` row for me (handled above), it's likely a
      // transient RLS race. Re-insert myself.
      const meMissing = !list.some((row) => row.user_id === session.user.id);
      if (meMissing && syncSession.join_code && myRow == null) {
        await supabase.rpc("join_sync_session", {
          p_join_code: syncSession.join_code,
          p_display_name: settings?.name || "",
        });
        const { data: p2 } = await fetchSyncParticipants(sessionId);
        setSyncParticipants(p2 || []);
      }
    };
    const channel = supabase.channel(`sync-presence:${sessionId}`);

    // Presence — also drives participant refetch as a fallback
    // for cases where postgres_changes events don't reach the leader.
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const map = {};
      for (const key of Object.keys(state)) {
        for (const p of state[key]) { map[p.user_id] = true; }
      }
      setPresenceMap(map);
      refetch();
    });
    channel.on("presence", { event: "join" }, refetch);
    channel.on("presence", { event: "leave" }, refetch);

    // Participant changes
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sync_session_participants", filter: `session_id=eq.${sessionId}` },
      refetch
    );

    // Session row changes — propagates leader_id transfers, status='ended', etc.
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "sync_sessions", filter: `id=eq.${sessionId}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.status === "ended") {
          // Session was ended (e.g. last leader left). Drop local state.
          setSyncSession(null);
          setSyncParticipants([]);
          setPresenceMap({});
          localStorage.removeItem("ql_sync_session");
          return;
        }
        // Merge new session fields (leader_id, etc.) without clobbering timer
        // state already applied by PomodoroTimer's separate subscription.
        setSyncSession((prev) => (prev ? { ...prev, ...row } : row));
      }
    );

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: session.user.id });
      }
    });

    // Polling fallback: 15s refetch in case realtime drops.
    const pollId = setInterval(refetch, 15000);

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [syncSession?.id, session.user.id]);

  function handleSessionJoined(sess) {
    setSyncSession(sess);
    setShowSyncModal(false);
    setShowPomodoro(true);
    localStorage.setItem("ql_sync_session", JSON.stringify({ sessionId: sess.id }));
    try { new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" }); } catch { /* ignore */ }
    fetchSyncParticipants(sess.id).then(({ data: p }) => setSyncParticipants(p || []));
  }

  // Listen for sync-session join events fired from elsewhere in the app
  // (e.g. TeamPage's "Join active session" button). BroadcastChannel is
  // cross-tab only — for the same tab we use a window CustomEvent.
  useEffect(() => {
    function onJoined(ev) {
      const sess = ev.detail?.session;
      if (sess?.id) handleSessionJoined(sess);
    }
    window.addEventListener("ql-sync-session-joined", onJoined);
    return () => window.removeEventListener("ql-sync-session-joined", onJoined);
    // handleSessionJoined uses functional setters + stable refs — safe to
    // omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeaveSync = useCallback(async () => {
    if (syncSession) {
      await leaveSyncSession(syncSession.id);
    }
    setSyncSession(null);
    setSyncParticipants([]);
    setPresenceMap({});
    localStorage.removeItem("ql_sync_session");
    try { new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" }); } catch { /* ignore */ }
  }, [syncSession]);

  async function handleTransferLeader(newLeaderId) {
    if (!syncSession) return;
    const { data, error } = await transferSyncLeader(syncSession.id, newLeaderId);
    if (error) {
      console.warn("transfer leader:", error.message);
      return;
    }
    if (data?.session) {
      setSyncSession(data.session);
    }
    fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
  }

  async function handleSetStatus(status) {
    if (!syncSession) return;
    const { error } = await setSyncParticipantStatus(syncSession.id, status);
    if (error) { console.warn("set status:", error.message); return; }
    fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
  }

  async function handleKickParticipant(userIdToKick) {
    if (!syncSession) return;
    const { error } = await kickSyncParticipant(syncSession.id, userIdToKick);
    if (error) {
      console.warn("kick participant:", error.message);
      return;
    }
    fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
  }

  async function handleEndSync() {
    if (syncSession) {
      await endSyncSession(syncSession.id);
    }
    setSyncSession(null);
    setSyncParticipants([]);
    setPresenceMap({});
    localStorage.removeItem("ql_sync_session");
    try { new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" }); } catch { /* ignore */ }
  }

  const syncState = {
    syncSession, syncParticipants, presenceMap,
    onOpenSync: () => setShowSyncModal(true),
    onLeaveSync: handleLeaveSync,
    onEndSync: handleEndSync,
    onTransferLeader: handleTransferLeader,
    onKickParticipant: handleKickParticipant,
    onSetStatus: handleSetStatus,
    currentTaskHint,
  };

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
          {!onPomodoroPage && (
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
              onTransferLeader={handleTransferLeader}
              onKickParticipant={handleKickParticipant}
              onSetStatus={handleSetStatus}
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
            <Route path="/" element={<LogPage />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/team/timesheets" element={<TeamTimesheetsPage />} />
            <Route path="/pomodoro" element={<PomodoroPage session={session} syncState={syncState} />} />
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

  // The popout window and the public join page render outside the auth gate
  // and the AppLayout — popout has its own provider stack inside, and the
  // join page handles the auth/guest flow itself.
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/pomodoro/join/:code" element={<JoinSyncPage />} />
          <Route
            path="/*"
            element={
              session ? (
                <AppProvider session={session}>
                  <TeamProvider session={session}>
                    <AppLayout session={session} />
                  </TeamProvider>
                </AppProvider>
              ) : (
                <AuthPage />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
