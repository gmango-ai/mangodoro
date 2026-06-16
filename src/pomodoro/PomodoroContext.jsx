import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../supabase";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTeam } from "../context/TeamContext";
import { isMobileApp } from "../lib/platform";
import {
  cancelPomodoroNotification,
  schedulePomodoroNotification,
} from "../lib/nativeNotifications";
import {
  consumePendingTimerToggle,
  hasPersistentTimerSurface,
  pausePersistentTimer,
  startPersistentTimer,
  stopPersistentTimer,
} from "../lib/persistentTimer";
import {
  loadPomodoroSoundSettings, playCompletionSound,
  USER_SOUND_PREFIX, TEAM_SOUND_PREFIX,
} from "../lib/pomodoroSound";
import { evaluateRemoteRow, remoteRemainingSeconds } from "./applyRemoteRow";
import {
  beginTransition as beginTransitionCmd,
  commitToPhase as commitToPhaseCmd,
  flushToServer,
} from "./commands";
import {
  TRANSITION_SECONDS,
  defaultBreakForStreak,
} from "./constants";
import { hasTimerProgress, remoteUpdatedAtMs } from "./derive";
import {
  loadAutoTransition,
  loadStoredDurations,
  saveAutoTransition,
  saveStoredDurations,
} from "./storage";
import { useTimerTick } from "./useTimerTick";

const PomodoroContext = createContext(null);

export function PomodoroProvider({ userId, children }) {
  const appCtx = useApp();
  const teamCtx = useTeam();
  const customSoundUrl = appCtx?.settings?.pomodoroSoundUrl || "";
  // Flatten user + team custom sound lists into a single lookup keyed
  // by preset id, so playCompletionSound can resolve whichever the user
  // picked without us caring which scope it came from.
  const customSoundsByPresetId = useMemo(() => {
    const map = {};
    for (const s of appCtx?.settings?.customSounds || []) {
      if (s?.url) map[`${USER_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    for (const s of teamCtx?.teamSounds || []) {
      if (s?.url) map[`${TEAM_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    return map;
  }, [appCtx?.settings?.customSounds, teamCtx?.teamSounds]);
  const { syncSession, leaveSession } = useSyncSession();
  const activeTeamId = teamCtx?.activeTeamId;

  const [mode, setMode] = useState("work");
  const [durations, setDurations] = useState(() => loadStoredDurations());
  const [secondsLeft, setSecondsLeft] = useState(() => loadStoredDurations().work);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [pendingMode, setPendingMode] = useState(null);
  const [autoTransition, setAutoTransitionState] = useState(() => loadAutoTransition());
  const [pendingAction, setPendingAction] = useState(null);
  // Realtime channel state for the "Reconnecting…" pill. SUBSCRIBED
  // means we're getting live updates; anything else means the channel
  // is in error / closed / mid-reconnect. We surface this on the value
  // so the timer and popout can render a subtle indicator without
  // peeking at the supabase-js internals themselves.
  const [realtimeStatus, setRealtimeStatus] = useState("SUBSCRIBED");

  const durationsRef = useRef(durations);
  durationsRef.current = durations;

  const modeRef = useRef(mode);
  const sessionsRef = useRef(sessions);
  const pendingModeRef = useRef(pendingMode);
  modeRef.current = mode;
  sessionsRef.current = sessions;
  pendingModeRef.current = pendingMode;

  const latestRef = useRef({ mode, sessions, isRunning, secondsLeft, pendingMode });
  latestRef.current = { mode, sessions, isRunning, secondsLeft, pendingMode };

  const endsAtMsRef = useRef(null);
  const suppressRemoteUntilRef = useRef(0);
  const lastLocalWriteAtMsRef = useRef(null);
  const userHasMutatedRef = useRef(false);
  const completionHandledRef = useRef(null);
  // Hold the latest callbacks so the lockscreen-action reconciliation
  // effect can invoke them without retaking the effect on every state
  // change.
  const toggleRunRef = useRef(null);
  const resetTimerRef = useRef(null);
  const autoTransitionRef = useRef(autoTransition);
  autoTransitionRef.current = autoTransition;

  // Reset timer state when the user switches orgs. Without this, the
  // /pomodoro page and any embedded surface kept ticking down on the
  // previous org's durations + sessions count even though the user
  // had switched contexts. We also pull the user out of any sync
  // session they were in (different org's room, different team).
  const prevTeamIdRef = useRef(activeTeamId);
  useEffect(() => {
    if (prevTeamIdRef.current === activeTeamId) return;
    prevTeamIdRef.current = activeTeamId;
    // Skip the very first run (mount) — useEffect runs once before
    // there's any "previous" team. This only triggers on actual
    // org changes mid-session.
    if (activeTeamId === undefined) return;
    setIsRunning(false);
    setPendingMode(null);
    setPendingAction(null);
    setSessions(0);
    setMode("work");
    setSecondsLeft(durationsRef.current.work);
    endsAtMsRef.current = null;
    completionHandledRef.current = null;
    userHasMutatedRef.current = false;
    // If we were in a sync session, leave it — the session belongs to
    // the previous org's team. The leave() RPC handles RLS / errors
    // gracefully even if the row is already gone.
    if (syncSession?.id && leaveSession) {
      leaveSession().catch(() => { /* best-effort */ });
    }
  }, [activeTeamId, syncSession?.id, leaveSession]);

  const isSynced = !!syncSession;
  const isLeader = isSynced && syncSession?.leader_id === userId;
  const isController = isSynced && syncSession?.controller_id === userId;
  const canControl = !isSynced || isController;
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;

  const flushDeps = useMemo(
    () => ({
      userId,
      syncSession,
      latestRef,
      endsAtMsRef,
      suppressRemoteUntilRef,
      lastLocalWriteAtMsRef,
    }),
    [userId, syncSession]
  );

  const setters = useMemo(
    () => ({
      setMode,
      setPendingMode,
      setSecondsLeft,
      setIsRunning,
      setSessions,
    }),
    []
  );

  const markUserMutated = useCallback(() => {
    userHasMutatedRef.current = true;
  }, []);

  function currentRemainingSeconds() {
    const local = latestRef.current;
    if (local.isRunning && endsAtMsRef.current) {
      return Math.max(0, Math.ceil((endsAtMsRef.current - Date.now()) / 1000));
    }
    return local.secondsLeft;
  }

  const applyPatch = useCallback((patch) => {
    completionHandledRef.current = null;
    if (patch.endsAtMs !== undefined) endsAtMsRef.current = patch.endsAtMs;
    latestRef.current = patch.latestRef;
    setMode(patch.mode);
    setSessions(patch.sessions);
    setPendingMode(patch.pendingMode);
    setIsRunning(patch.isRunning);
    setSecondsLeft(patch.secondsLeft);
  }, []);

  const applyRemoteRow = useCallback(
    (row, { force = false } = {}) => {
      const result = evaluateRemoteRow({
        row,
        force,
        lastLocalWriteAtMs: lastLocalWriteAtMsRef.current,
        suppressUntilMs: suppressRemoteUntilRef.current,
      });
      if (result.action === "skip") return;
      applyPatch(result.patch);
    },
    [applyPatch]
  );

  const doFlush = useCallback(
    (override) => flushToServer({ ...flushDeps, override }),
    [flushDeps]
  );

  const commitToPhase = useCallback(
    async (nextMode, sessionsVal, autoStart) => {
      await commitToPhaseCmd({
        nextMode,
        sessionsVal,
        autoStart,
        durationsRef,
        flushDeps,
        setters,
        markUserMutated,
        completionHandledRef,
      });
    },
    [flushDeps, markUserMutated, setters]
  );

  const beginTransition = useCallback(
    async (nextBreak, sessionsVal) => {
      await beginTransitionCmd({
        nextBreak,
        sessionsVal,
        transitionSeconds: TRANSITION_SECONDS,
        flushDeps,
        setters,
        markUserMutated,
        completionHandledRef,
      });
    },
    [flushDeps, markUserMutated, setters]
  );

  const commitTransition = useCallback(async () => {
    const target = pendingModeRef.current;
    if (!target) return;
    const sessionsVal = sessionsRef.current;
    await commitToPhase(target, sessionsVal, true);
  }, [commitToPhase]);

  const syncFromDB = useCallback(
    async ({ skipIfSynced = false } = {}) => {
      if (!userId) return;

      function maybeApply(data, { force = false } = {}) {
        if (!data) return;
        if (
          skipIfSynced &&
          !force &&
          Math.abs(remoteRemainingSeconds(data) - currentRemainingSeconds()) <= 3
        ) {
          return;
        }
        applyRemoteRow(data, { force });
      }

      if (syncSession?.id) {
        const { data } = await supabase
          .from("sync_sessions")
          .select("*")
          .eq("id", syncSession.id)
          .eq("status", "active")
          .maybeSingle();
        maybeApply(data);
        return;
      }

      const { data } = await supabase
        .from("user_pomodoro_state")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      maybeApply(data);
    },
    [userId, syncSession?.id, applyRemoteRow]
  );

  // Solo hydrate
  useEffect(() => {
    if (!userId || syncSession) return;
    let cancelled = false;
    (async () => {
      // Drain pending lockscreen actions FIRST. If the user stopped or
      // toggled the timer from the widget while the app was backgrounded,
      // we want to apply that locally before pulling the (now-stale)
      // remote row — otherwise the older Supabase state reinstates the
      // running timer for a beat, the activity reappears, then reconcile
      // catches up and resets.
      const lockscreenAction = await consumePendingTimerToggle();
      if (cancelled) return;
      if (lockscreenAction.pendingStop) {
        resetTimerRef.current?.();
        return; // Local reset wins; skip the hydrate.
      }
      if (
        lockscreenAction.pending &&
        lockscreenAction.nowRunning !== latestRef.current.isRunning
      ) {
        toggleRunRef.current?.();
        // Don't return — keep hydrating to merge non-timer fields.
      }

      const { data, error } = await supabase
        .from("user_pomodoro_state")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const remoteMs = remoteUpdatedAtMs(data);
      const lastWriteMs = lastLocalWriteAtMsRef.current;
      if (userHasMutatedRef.current) {
        if (lastWriteMs == null) return;
        if (remoteMs != null && remoteMs < lastWriteMs - 100) return;
      }
      suppressRemoteUntilRef.current = 0;
      applyRemoteRow(data);
      suppressRemoteUntilRef.current = Date.now() + 400;
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, applyRemoteRow, syncSession]);

  // Sync hydrate when session joins
  useEffect(() => {
    if (!syncSession?.id) return;
    suppressRemoteUntilRef.current = 0;
    applyRemoteRow(syncSession, { force: true });
    suppressRemoteUntilRef.current = Date.now() + 400;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per session id
  }, [syncSession?.id]);

  // Solo Realtime. The `subscribe` callback flips realtimeStatus so the
  // popout / main timer can render a "Reconnecting…" pill. SUBSCRIBED
  // after a transient drop = silently re-pull authoritative state, no
  // user confirmation.
  useEffect(() => {
    if (!userId || syncSession) return;
    let wasSubscribed = false;
    const channel = supabase
      .channel(`pomodoro:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_pomodoro_state",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new;
          if (row && typeof row === "object") applyRemoteRow(row);
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(status);
        if (status === "SUBSCRIBED") {
          // First SUBSCRIBED on mount is handled by the hydrate effect.
          // Anything after a drop is a reconnect — pull fresh state.
          if (wasSubscribed) syncFromDB();
          wasSubscribed = true;
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, applyRemoteRow, syncSession, syncFromDB]);

  // Sync Realtime — timer fields only (single subscription)
  useEffect(() => {
    if (!syncSession?.id) return;
    let wasSubscribed = false;
    const channel = supabase
      .channel(`sync-session-timer:${syncSession.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sync_sessions",
          filter: `id=eq.${syncSession.id}`,
        },
        (payload) => {
          const row = payload.new;
          if (row && typeof row === "object") {
            if (row.status === "ended") {
              leaveSession?.();
              return;
            }
            applyRemoteRow(row);
          }
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(status);
        if (status === "SUBSCRIBED") {
          if (wasSubscribed) syncFromDB();
          wasSubscribed = true;
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncSession?.id, applyRemoteRow, leaveSession, syncFromDB]);

  // Tab regaining focus → silently re-pull authoritative state.
  useEffect(() => {
    if (!userId) return;
    function onVisible() {
      if (!document.hidden) syncFromDB();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, syncFromDB]);

  // Two interval-based safety nets:
  //   • While running: 30s — catches subtle drift between local tick
  //     and server `ends_at` even when Realtime is healthy.
  //   • Always: 60s — last-resort reconcile in case both Realtime AND
  //     visibilitychange somehow miss a state update (e.g., a
  //     long-lived background tab whose connection silently rotted).
  useEffect(() => {
    if (!isRunning || !userId) return;
    const id = setInterval(() => syncFromDB({ skipIfSynced: true }), 30_000);
    return () => clearInterval(id);
  }, [isRunning, userId, syncSession?.id, syncFromDB]);

  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => syncFromDB(), 60_000);
    return () => clearInterval(id);
  }, [userId, syncFromDB]);

  useTimerTick({ isRunning, userId, endsAtMsRef, setSecondsLeft });

  // Schedule (or cancel) the native local notification that fires when
  // the current phase ends. Native WebViews get suspended a few dozen
  // seconds after backgrounding — the in-page completion effect below
  // never runs, so the alarm has to come from the OS. We re-schedule on
  // every phase transition (mode/sessions change) and key off
  // endsAtMsRef when it's been populated by the DB round-trip,
  // falling back to a local clock derivation for the first frame
  // after toggleRun flips isRunning to true. secondsLeft is read from
  // the closure intentionally — adding it to deps would reschedule on
  // every tick.
  useEffect(() => {
    if (!isMobileApp) return;
    if (!isRunning) {
      cancelPomodoroNotification();
      return;
    }
    const endsAt = endsAtMsRef.current || Date.now() + secondsLeft * 1000;
    // The preset that should play depends on which phase is ending:
    // a running work phase ends with the focus-end alarm, a running
    // break phase ends with the break-end alarm. We read fresh from
    // localStorage so changes in the picker take effect on the next
    // scheduling round-trip without us having to hoist the settings
    // into context.
    const settings = loadPomodoroSoundSettings();
    const presetId = mode === "work"
      ? settings.workEndPreset
      : settings.breakEndPreset;
    schedulePomodoroNotification({
      endsAtMs: endsAt,
      mode,
      isSynced,
      presetId,
      userSounds: appCtx?.settings?.customSounds || [],
      teamSounds: teamCtx?.teamSounds || [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondsLeft is read at scheduling time only; ticking does not reschedule
  }, [isRunning, mode, sessions, pendingMode, isSynced, appCtx?.settings?.customSounds, teamCtx?.teamSounds]);

  // Drive the live-countdown surfaces — iOS Live Activity (lockscreen +
  // Dynamic Island), Android ongoing notification with chronometer, and
  // the Electron tray. Each self-ticks from the OS once we hand it the
  // end timestamp, so this effect only fires on phase boundaries.
  //
  // Pause does NOT stop the activity — we freeze it via
  // pausePersistentTimer so the lockscreen keeps showing the snapshot.
  // The only paths that end the activity are reset/switch-mode/custom-
  // duration (handled directly in those callbacks below) and phase
  // completion (handled in the completion effect).
  useEffect(() => {
    if (!hasPersistentTimerSurface) return;
    const phaseMode = pendingMode || mode;
    if (isRunning) {
      const endsAt = endsAtMsRef.current || Date.now() + secondsLeft * 1000;
      startPersistentTimer({ endsAtMs: endsAt, mode: phaseMode, isSynced });
    } else {
      pausePersistentTimer({
        pausedSecondsLeft: secondsLeft,
        mode: phaseMode,
        isSynced,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondsLeft is read at scheduling time only; ticking does not reschedule
  }, [isRunning, mode, sessions, pendingMode, isSynced]);

  // Reconcile the JS-side timer state with whatever the widget showed
  // after the user tapped pause/resume/stop from the lockscreen. The
  // intents update the activity UI immediately and drop flags into the
  // App Group; we poll for those flags here so foreground races (app
  // open while widget changes state) converge in a couple of seconds
  // rather than only on visibility change.
  useEffect(() => {
    if (!hasPersistentTimerSurface || !userId) return;
    let cancelled = false;
    async function reconcile() {
      const { pending, nowRunning, pendingStop } = await consumePendingTimerToggle();
      if (cancelled) return;
      if (pendingStop) {
        // Widget stop → reset the timer through the normal callback so
        // Supabase, the alarm, and any other surfaces wind down too.
        resetTimerRef.current?.();
        return;
      }
      if (pending && nowRunning !== latestRef.current.isRunning) {
        toggleRunRef.current?.();
      }
    }
    reconcile();
    const interval = setInterval(reconcile, 2000);
    function onVisible() {
      if (!document.hidden) reconcile();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are read via ref so latest closure is always used
  }, [userId]);

  // Completion + transition
  useEffect(() => {
    if (!isRunning || secondsLeft > 0) return;

    const completionKey = `${modeRef.current}-${sessionsRef.current}-${pendingModeRef.current ?? "none"}-${endsAtMsRef.current ?? "paused"}`;
    if (completionHandledRef.current === completionKey) return;
    completionHandledRef.current = completionKey;

    const currentPending = pendingModeRef.current;

    if (currentPending) {
      commitTransition();
      return;
    }

    setIsRunning(false);

    const currentMode = modeRef.current;
    const currentSessions = sessionsRef.current;

    if (!isSynced || isController) {
      playCompletionSound(loadPomodoroSoundSettings(), {
        event: currentMode === "work" ? "work" : "break",
        customSoundUrl,
        customSoundsByPresetId,
      });

      // Web-only browser notification. On native the foreground/background
      // alarm is handled by the OS via @capacitor/local-notifications —
      // scheduled in the effect below the moment a phase starts running.
      if (!isMobileApp && "Notification" in window && Notification.permission === "granted") {
        new Notification(
          currentMode === "work"
            ? isSynced
              ? "Sync session: Time for a break!"
              : "Pomodoro done! Time for a break."
            : isSynced
              ? "Sync session: Break over — back to focus!"
              : "Break over — back to focus!",
          { icon: "/icon-192.png", tag: "pomodoro" }
        );
      }
    }

    if (isSynced && !isController) return;

    if (currentMode === "work") {
      const nextStreak = currentSessions + 1;
      const nextBreak = defaultBreakForStreak(nextStreak);
      setSessions(nextStreak);
      if (autoTransitionRef.current) {
        beginTransition(nextBreak, nextStreak);
      } else {
        commitToPhase(nextBreak, nextStreak, true);
      }
    } else {
      const nextSessions = currentMode === "longBreak" ? 0 : currentSessions;
      setSessions(nextSessions);
      commitToPhase("work", nextSessions, false);
    }
  }, [
    secondsLeft,
    isRunning,
    customSoundUrl,
    customSoundsByPresetId,
    isSynced,
    isController,
    beginTransition,
    commitToPhase,
    commitTransition,
  ]);

  const switchMode = useCallback(
    (newMode, { resetStreak = false } = {}) => {
      if (!canControl) return;
      completionHandledRef.current = null;
      markUserMutated();
      const dur = durations[newMode];
      setMode(newMode);
      setPendingMode(null);
      setSecondsLeft(dur);
      setIsRunning(false);
      endsAtMsRef.current = null;
      setPendingAction(null);
      const nextSessions = resetStreak ? 0 : sessions;
      if (resetStreak) setSessions(0);
      // Explicit user action — end the live activity rather than freeze
      // it, since the underlying phase/duration just changed.
      if (hasPersistentTimerSurface) stopPersistentTimer();
      doFlush({
        mode: newMode,
        pending_mode: null,
        remaining_seconds: dur,
        is_running: false,
        sessions: nextSessions,
      });
    },
    [canControl, durations, sessions, doFlush, markUserMutated]
  );

  const resetTimer = useCallback(() => {
    if (!canControl) return;
    completionHandledRef.current = null;
    markUserMutated();
    const dur = durations[mode];
    setSecondsLeft(dur);
    setPendingMode(null);
    setIsRunning(false);
    endsAtMsRef.current = null;
    setPendingAction(null);
    if (hasPersistentTimerSurface) stopPersistentTimer();
    doFlush({ remaining_seconds: dur, is_running: false, pending_mode: null });
  }, [canControl, durations, mode, doFlush, markUserMutated]);
  resetTimerRef.current = resetTimer;

  const applyCustomDuration = useCallback(
    (minutesStr, persist) => {
      if (!canControl) return;
      completionHandledRef.current = null;
      markUserMutated();
      const m = parseFloat(minutesStr);
      if (!Number.isFinite(m) || m <= 0) return;
      const secs = Math.max(1, Math.round(m * 60));
      if (persist) {
        const next = { ...durations, [mode]: secs };
        setDurations(next);
        saveStoredDurations(next);
      } else {
        setDurations((prev) => ({ ...prev, [mode]: secs }));
      }
      setSecondsLeft(secs);
      setPendingMode(null);
      setIsRunning(false);
      endsAtMsRef.current = null;
      setPendingAction(null);
      if (hasPersistentTimerSurface) stopPersistentTimer();
      doFlush({ remaining_seconds: secs, is_running: false, pending_mode: null });
    },
    [canControl, durations, mode, doFlush, markUserMutated]
  );

  const requestSwitchMode = useCallback(
    (newMode) => {
      if (!canControl || newMode === mode) return;
      if (pendingAction) return;
      if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
        setPendingAction({ type: "switchMode", newMode });
      } else {
        switchMode(newMode);
      }
    },
    [canControl, mode, pendingAction, durations, secondsLeft, isRunning, switchMode]
  );

  const requestReset = useCallback(() => {
    if (!canControl) return;
    if (pendingAction) return;
    if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
      setPendingAction({ type: "reset" });
    } else {
      resetTimer();
    }
  }, [canControl, pendingAction, mode, durations, secondsLeft, isRunning, resetTimer]);

  const requestApplyCustomDuration = useCallback(
    (minutesStr, persist) => {
      if (!canControl) return;
      if (pendingAction) return;
      if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
        setPendingAction({ type: "applyCustomDuration", minutesStr, persist });
      } else {
        applyCustomDuration(minutesStr, persist);
      }
    },
    [canControl, pendingAction, mode, durations, secondsLeft, isRunning, applyCustomDuration]
  );

  const switchAlternateBreak = useCallback(() => {
    if (!canControl || pendingMode) return;
    if (mode !== "shortBreak" && mode !== "longBreak") return;
    const alt = mode === "shortBreak" ? "longBreak" : "shortBreak";
    if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
      setPendingAction({ type: "switchAlternateBreak", newMode: alt });
    } else {
      switchMode(alt, { resetStreak: true });
    }
  }, [canControl, pendingMode, mode, durations, secondsLeft, isRunning, switchMode]);

  const confirmPendingAction = useCallback(() => {
    if (!pendingAction) return;
    if (pendingAction.type === "switchMode") switchMode(pendingAction.newMode);
    else if (pendingAction.type === "switchAlternateBreak")
      switchMode(pendingAction.newMode, { resetStreak: true });
    else if (pendingAction.type === "reset") resetTimer();
    else if (pendingAction.type === "applyCustomDuration") {
      applyCustomDuration(pendingAction.minutesStr, pendingAction.persist);
    }
    setPendingAction(null);
  }, [pendingAction, switchMode, resetTimer, applyCustomDuration]);

  const toggleRun = useCallback(async () => {
    if (!canControl) return;
    markUserMutated();
    if (!isRunning && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const willRun = !isRunning;
    if (!willRun) {
      // Pausing — drop the recorded endsAt so the next resume's
      // persistentTimer effect computes a fresh one from secondsLeft
      // (instead of reusing the pre-pause endsAt that's now in the past).
      endsAtMsRef.current = null;
    }
    setIsRunning(willRun);
    await doFlush({
      is_running: willRun,
      remaining_seconds: currentRemainingSeconds(),
    });
  }, [canControl, isRunning, doFlush, markUserMutated]);
  toggleRunRef.current = toggleRun;

  const skipTransition = useCallback(async () => {
    if (!canControl || !pendingMode) return;
    markUserMutated();
    await commitTransition();
  }, [canControl, pendingMode, commitTransition, markUserMutated]);

  const setAutoTransition = useCallback((enabled) => {
    setAutoTransitionState(enabled);
    saveAutoTransition(enabled);
  }, []);

  const cancelPendingAction = useCallback(() => setPendingAction(null), []);

  const value = useMemo(
    () => ({
      userId,
      mode,
      secondsLeft,
      isRunning,
      sessions,
      pendingMode,
      durations,
      autoTransition,
      isSynced,
      isLeader,
      isController,
      canControl,
      pendingAction,
      realtimeStatus,
      toggleRun,
      resetTimer: requestReset,
      switchMode: requestSwitchMode,
      switchAlternateBreak,
      skipTransition,
      applyCustomDuration: requestApplyCustomDuration,
      setAutoTransition,
      confirmPendingAction,
      cancelPendingAction,
      applyCustomDurationDirect: applyCustomDuration,
      resetTimerDirect: resetTimer,
      switchModeDirect: switchMode,
    }),
    [
      userId,
      mode,
      secondsLeft,
      isRunning,
      sessions,
      pendingMode,
      durations,
      autoTransition,
      isSynced,
      isLeader,
      isController,
      canControl,
      pendingAction,
      realtimeStatus,
      toggleRun,
      requestReset,
      requestSwitchMode,
      switchAlternateBreak,
      skipTransition,
      requestApplyCustomDuration,
      setAutoTransition,
      confirmPendingAction,
      cancelPendingAction,
      applyCustomDuration,
      resetTimer,
      switchMode,
    ]
  );

  return (
    <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>
  );
}

export function usePomodoro() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) {
    throw new Error("usePomodoro must be used within PomodoroProvider");
  }
  return ctx;
}
