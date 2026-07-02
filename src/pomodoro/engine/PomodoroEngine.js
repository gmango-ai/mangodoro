import { supabase } from "../../supabase.js";
import { isMobileApp } from "../../lib/platform.js";
import {
  cancelPomodoroNotification,
  schedulePomodoroNotification,
} from "../../lib/nativeNotifications.js";
import {
  consumePendingTimerToggle,
  hasPersistentTimerSurface,
  pausePersistentTimer,
  startPersistentTimer,
  stopPersistentTimer,
} from "../../lib/persistentTimer.js";
import {
  loadPomodoroSoundSettings,
  playCompletionSound,
  stopCompletionSound,
  warmupAudioContext,
} from "../../lib/pomodoroSound.js";
import { evaluateRemoteRow, remoteRemainingSeconds } from "../applyRemoteRow.js";
import {
  beginTransition as beginTransitionCmd,
  commitToPhase as commitToPhaseCmd,
  flushToServer,
} from "../commands.js";
import {
  TRANSITION_SECONDS,
  defaultBreakForStreak,
} from "../constants.js";
import { hasTimerProgress, remoteUpdatedAtMs } from "../derive.js";
import {
  loadAutoTransition,
  loadStoredDurations,
  saveAutoTransition,
  saveStoredDurations,
  parseDurationsFromRow,
  parseAutoTransitionFromRow,
} from "../storage.js";
import { createElectronTimerBridge } from "./electronTimerBridge.js";
import { createTabLeader } from "./tabLeader.js";
import {
  derivePhaseEndEvent,
  phaseAlarmKey,
  tryClaimPhaseAlarm,
} from "../phaseAlarm.js";

// A phase-end alarm must only fire when a RUNNING timer's deadline arrived —
// never on a manual mode switch, which happens with time still on the clock
// (or while paused). We treat the previous phase as "expired" when its endsAt
// is at/just-past now; the grace absorbs clock skew + realtime propagation lag
// between sync participants so a genuine completion still rings for everyone.
const PHASE_END_GRACE_MS = 2000;

export class PomodoroEngine {
  constructor(userId) {
    this.userId = userId;
    this._refCount = 0;
    this._forceSlave = false;
    this._listeners = new Set();
    this._snapshot = null;
    this._publicApi = null;
    this._leaderLifecycleActive = false;
    // Fingerprint of the inputs the native persistent-timer / notification
    // side-effects depend on (endsAt + phase, NOT the per-second countdown), so
    // we only cross the JS↔native bridge when they actually change — see
    // _runDerivedSideEffects.
    this._lastNativeSideEffectFp = null;
    this._teamIdInitialized = false;
    this._cleanups = [];
    this._tabLeader = null;
    this._electronBridge = null;

    this._deps = {
      syncSession: null,
      leaveSession: null,
      customSoundUrl: "",
      customSoundsByPresetId: {},
      activeTeamId: undefined,
      userCustomSounds: [],
      teamSounds: [],
    };

    const storedDurations = loadStoredDurations();
    this._state = {
      mode: "work",
      durations: storedDurations,
      secondsLeft: storedDurations.work,
      isRunning: false,
      sessions: 0,
      pendingMode: null,
      autoTransition: loadAutoTransition(),
      pendingAction: null,
      realtimeStatus: "SUBSCRIBED",
    };

    this._refs = {
      durationsRef: { current: storedDurations },
      modeRef: { current: "work" },
      sessionsRef: { current: 0 },
      pendingModeRef: { current: null },
      latestRef: {
        current: {
          mode: "work",
          sessions: 0,
          isRunning: false,
          secondsLeft: storedDurations.work,
          pendingMode: null,
        },
      },
      endsAtMsRef: { current: null },
      suppressRemoteUntilRef: { current: 0 },
      lastLocalWriteAtMsRef: { current: null },
      userHasMutatedRef: { current: false },
      completionHandledRef: { current: null },
      lastAlarmKeyPlayedRef: { current: null },
      autoTransitionRef: { current: loadAutoTransition() },
      prevTeamId: undefined,
      canControlRef: { current: true },
      toggleRunRef: { current: null },
      resetTimerRef: { current: null },
    };

    this._realtimeWasSubscribed = { solo: false, sync: false };
    this._soloHydrateCancelled = false;
    this._lockscreenCancelled = false;
    this._syncTickCleanup = null;
    this._completionTimeoutId = null;
  }

  configure(deps) {
    const prevSyncId = this._deps.syncSession?.id;
    const prevTeamId = this._deps.activeTeamId;

    Object.assign(this._deps, deps);

    if (!this._teamIdInitialized) {
      this._teamIdInitialized = true;
      this._refs.prevTeamId = deps.activeTeamId;
    } else if (prevTeamId !== deps.activeTeamId) {
      this._refs.prevTeamId = deps.activeTeamId;
      if (deps.activeTeamId !== undefined && this._leaderLifecycleActive) {
        this._handleTeamChange();
      }
    }

    if (!this._leaderLifecycleActive) {
      if (prevSyncId !== deps.syncSession?.id && deps.syncSession?.id && !this._isLeaderRole()) {
        this._hydrateSync();
      }
      return;
    }

    if (prevSyncId !== deps.syncSession?.id) {
      this._teardownRealtime();
      this._setupRealtime();
      if (deps.syncSession?.id) {
        this._hydrateSync();
      } else {
        this._hydrateSolo();
      }
    }

    this._runDerivedSideEffects();
  }

  attach({ forceSlave = false } = {}) {
    this._forceSlave = forceSlave;
    this._refCount += 1;
    if (this._refCount === 1) {
      this._start();
    }
  }

  detach() {
    this._refCount = Math.max(0, this._refCount - 1);
    if (this._refCount === 0) {
      this._stop();
    }
  }

  destroy() {
    this._refCount = 0;
    this._stop();
    this._listeners.clear();
    this._snapshot = null;
    this._publicApi = null;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this._listeners.delete(listener);
    };
  }

  getSnapshot() {
    if (!this._snapshot) {
      this._snapshot = { ...this._buildSnapshot(), ...this.getPublicApi() };
    }
    return this._snapshot;
  }

  getPublicApi() {
    if (!this._publicApi) {
      this._publicApi = {
        toggleRun: (...args) => this._invokeOrForward("toggleRun", args),
        resetTimer: (...args) => this._invokeOrForward("requestReset", args),
        switchMode: (...args) => this._invokeOrForward("requestSwitchMode", args),
        switchAlternateBreak: (...args) => this._invokeOrForward("switchAlternateBreak", args),
        skipTransition: (...args) => this._invokeOrForward("skipTransition", args),
        applyCustomDuration: (...args) => this._invokeOrForward("requestApplyCustomDuration", args),
        setAutoTransition: (...args) => this._invokeOrForward("setAutoTransition", args),
        confirmPendingAction: (...args) => this._invokeOrForward("confirmPendingAction", args),
        cancelPendingAction: (...args) => this._invokeOrForward("cancelPendingAction", args),
        applyCustomDurationDirect: (...args) => this._invokeOrForward("applyCustomDuration", args),
        resetTimerDirect: (...args) => this._invokeOrForward("resetTimer", args),
        switchModeDirect: (...args) => this._invokeOrForward("switchMode", args),
      };
    }
    return this._publicApi;
  }

  // ── Role helpers ──────────────────────────────────────────────────────────

  _isLeaderRole() {
    if (this._electronBridge?.isSlave) return false;
    if (this._tabLeader && !this._tabLeader.getIsLeader()) return false;
    return true;
  }

  _invokeOrForward(method, args) {
    if (!this._isLeaderRole()) {
      this._forwardCommand(method, args);
      return;
    }
    return this._executeCommand(method, args);
  }

  _forwardCommand(method, args) {
    if (this._electronBridge?.sendCommand(method, args)) return;
    this._tabLeader?.sendCommand(method, args);
  }

  _executeCommand(method, args) {
    const handlers = {
      toggleRun: () => this.toggleRun(),
      requestReset: () => this.requestReset(),
      requestSwitchMode: (newMode) => this.requestSwitchMode(newMode),
      switchAlternateBreak: () => this.switchAlternateBreak(),
      skipTransition: () => this.skipTransition(),
      requestApplyCustomDuration: (minutesStr, persist) =>
        this.requestApplyCustomDuration(minutesStr, persist),
      setAutoTransition: (enabled) => this.setAutoTransition(enabled),
      confirmPendingAction: () => this.confirmPendingAction(),
      cancelPendingAction: () => this.cancelPendingAction(),
      applyCustomDuration: (minutesStr, persist) =>
        this.applyCustomDuration(minutesStr, persist),
      resetTimer: () => this.resetTimer(),
      switchMode: (newMode, opts) => this.switchMode(newMode, opts),
    };
    const fn = handlers[method];
    if (fn) fn(...(args || []));
  }

  // ── State / notify ────────────────────────────────────────────────────────

  _syncRefs() {
    const s = this._state;
    this._refs.durationsRef.current = s.durations;
    this._refs.modeRef.current = s.mode;
    this._refs.sessionsRef.current = s.sessions;
    this._refs.pendingModeRef.current = s.pendingMode;
    this._refs.autoTransitionRef.current = s.autoTransition;
    this._refs.latestRef.current = {
      mode: s.mode,
      sessions: s.sessions,
      isRunning: s.isRunning,
      secondsLeft: s.secondsLeft,
      pendingMode: s.pendingMode,
    };
  }

  _setField(key, value) {
    if (typeof value === "function") {
      value = value(this._state[key]);
    }
    if (this._state[key] === value) return;
    this._state[key] = value;
    this._notify();
  }

  _patchState(patch) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (this._state[key] !== value) {
        this._state[key] = value;
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  _notify({ leaderSideEffects = true } = {}) {
    this._syncRefs();
    this._snapshot = { ...this._buildSnapshot(), ...this.getPublicApi() };

    if (this._isLeaderRole()) {
      const wire = this._getWireSnapshot();
      this._tabLeader?.broadcastState(wire);
      this._electronBridge?.broadcastState(wire);
    }

    for (const listener of this._listeners) {
      listener(this._snapshot);
    }

    if (leaderSideEffects && this._isLeaderRole()) {
      this._runDerivedSideEffects();
      this._runCompletionCheck();
    }
  }

  _getWireSnapshot() {
    return this._buildSnapshot();
  }

  _buildSnapshot() {
    const { syncSession } = this._deps;
    const isSynced = !!syncSession;
    const isLeader = isSynced && syncSession?.leader_id === this.userId;
    const isController = isSynced && syncSession?.controller_id === this.userId;
    const canControl = !isSynced || isController;
    this._refs.canControlRef.current = canControl;

    return {
      userId: this.userId,
      mode: this._state.mode,
      secondsLeft: this._state.secondsLeft,
      isRunning: this._state.isRunning,
      sessions: this._state.sessions,
      pendingMode: this._state.pendingMode,
      durations: this._state.durations,
      autoTransition: this._state.autoTransition,
      isSynced,
      isLeader,
      isController,
      canControl,
      pendingAction: this._state.pendingAction,
      realtimeStatus: this._state.realtimeStatus,
      endsAtMs: this._refs.endsAtMsRef.current,
    };
  }

  _applyFollowerSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    const prevMode = this._state.mode;
    const prevPending = this._state.pendingMode;
    const prevPhase = this._phaseFingerprint();
    const prevEndsAt = this._refs.endsAtMsRef.current;
    this._refs.completionHandledRef.current = null;
    if (snapshot.endsAtMs !== undefined) {
      this._refs.endsAtMsRef.current = snapshot.endsAtMs;
    }
    this._patchState({
      mode: snapshot.mode,
      sessions: snapshot.sessions,
      pendingMode: snapshot.pendingMode ?? null,
      isRunning: snapshot.isRunning,
      secondsLeft: snapshot.secondsLeft,
      ...(snapshot.durations ? { durations: snapshot.durations } : {}),
      ...(snapshot.autoTransition !== undefined
        ? { autoTransition: snapshot.autoTransition }
        : {}),
      ...(snapshot.pendingAction !== undefined
        ? { pendingAction: snapshot.pendingAction }
        : {}),
      ...(snapshot.realtimeStatus !== undefined
        ? { realtimeStatus: snapshot.realtimeStatus }
        : {}),
    });

    if (
      !this._isLeaderRole()
      && prevPhase !== this._phaseFingerprint()
      // Only a real completion rings — not a manual switch (deadline still in
      // the future, or paused).
      && this._phaseExpired(prevEndsAt)
    ) {
      const event = derivePhaseEndEvent(
        prevMode,
        this._state.mode,
        this._state.pendingMode,
        prevPending,
      );
      if (event) {
        void this._tryPlayPhaseAlarm(event, phaseAlarmKey(prevPhase, event), {
          synced: !!this._deps.syncSession,
        });
      }
    }
  }

  _markUserMutated() {
    this._refs.userHasMutatedRef.current = true;
  }

  _currentRemainingSeconds() {
    const local = this._refs.latestRef.current;
    if (local.isRunning && this._refs.endsAtMsRef.current) {
      return Math.max(
        0,
        Math.ceil((this._refs.endsAtMsRef.current - Date.now()) / 1000)
      );
    }
    return local.secondsLeft;
  }

  _getFlushDeps() {
    return {
      userId: this.userId,
      syncSession: this._deps.syncSession,
      latestRef: this._refs.latestRef,
      endsAtMsRef: this._refs.endsAtMsRef,
      suppressRemoteUntilRef: this._refs.suppressRemoteUntilRef,
      lastLocalWriteAtMsRef: this._refs.lastLocalWriteAtMsRef,
    };
  }

  _getSetters() {
    return {
      setMode: (mode) => this._setField("mode", mode),
      setPendingMode: (pendingMode) => this._setField("pendingMode", pendingMode),
      setSecondsLeft: (secondsLeft) => this._setField("secondsLeft", secondsLeft),
      setIsRunning: (isRunning) => this._setField("isRunning", isRunning),
      setSessions: (sessions) => this._setField("sessions", sessions),
    };
  }

  _applyPatch(patch) {
    this._refs.completionHandledRef.current = null;
    if (patch.endsAtMs !== undefined) {
      this._refs.endsAtMsRef.current = patch.endsAtMs;
    }
    this._refs.latestRef.current = patch.latestRef;
    this._patchState({
      mode: patch.mode,
      sessions: patch.sessions,
      pendingMode: patch.pendingMode,
      isRunning: patch.isRunning,
      secondsLeft: patch.secondsLeft,
    });
  }

  _applyRemoteRow(row, { force = false } = {}) {
    const prevPhase = this._phaseFingerprint();
    const result = evaluateRemoteRow({
      row,
      force,
      lastLocalWriteAtMs: this._refs.lastLocalWriteAtMsRef.current,
      suppressUntilMs: this._refs.suppressRemoteUntilRef.current,
    });
    if (result.action === "skip") return;

    const prevMode = this._state.mode;
    const prevPending = this._state.pendingMode;
    const prevEndsAt = this._refs.endsAtMsRef.current;
    this._applyPatch(result.patch);
    this._mergeRowPreferences(row);

    if (this._deps.syncSession?.id && prevPhase !== this._phaseFingerprint()) {
      this._maybePlaySyncPhaseSound(prevMode, prevPhase, prevEndsAt, prevPending);
    }
  }

  _phaseFingerprint() {
    return `${this._state.mode}-${this._state.sessions}-${this._state.pendingMode ?? "none"}-${this._refs.endsAtMsRef.current ?? "paused"}`;
  }

  _completionKey() {
    return `${this._refs.modeRef.current}-${this._refs.sessionsRef.current}-${this._refs.pendingModeRef.current ?? "none"}-${this._refs.endsAtMsRef.current ?? "paused"}`;
  }

  // True only if the previous phase had a running deadline that has (about to
  // have) arrived — i.e. a timer that "ran out". A manual mode switch leaves
  // the deadline in the future, or paused (null), so this returns false and we
  // stay silent for those.
  _phaseExpired(prevEndsAtMs) {
    return prevEndsAtMs != null && prevEndsAtMs <= Date.now() + PHASE_END_GRACE_MS;
  }

  async _tryPlayPhaseAlarm(event, alarmKey, { synced = false } = {}) {
    if (this._refs.lastAlarmKeyPlayedRef.current === alarmKey) return false;
    if (!tryClaimPhaseAlarm(alarmKey)) return false;

    const { customSoundUrl, customSoundsByPresetId } = this._deps;
    await playCompletionSound(loadPomodoroSoundSettings(), {
      event,
      customSoundUrl,
      customSoundsByPresetId,
    });
    this._refs.lastAlarmKeyPlayedRef.current = alarmKey;

    if (
      !isMobileApp
      && typeof window !== "undefined"
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      const soloWork = "Pomodoro done! Time for a break.";
      const soloBreak = "Break over — back to focus!";
      const syncWork = "Sync session: Time for a break!";
      const syncBreak = "Sync session: Break over — back to focus!";
      const body = synced
        ? (event === "work" ? syncWork : syncBreak)
        : (event === "work" ? soloWork : soloBreak);
      new Notification(body, { icon: "/icon-192.png", tag: "pomodoro" });
    }
    return true;
  }

  _clearCompletionTimeout() {
    if (this._completionTimeoutId) {
      clearTimeout(this._completionTimeoutId);
      this._completionTimeoutId = null;
    }
  }

  _scheduleCompletionTimeout() {
    this._clearCompletionTimeout();
    const endsAt = this._refs.endsAtMsRef.current;
    if (!this._state.isRunning || !endsAt) return;
    const delay = Math.max(0, endsAt - Date.now());
    this._completionTimeoutId = setTimeout(() => this._onWallClockDue(), delay);
  }

  _onWallClockDue() {
    if (!this._leaderLifecycleActive || !this._isLeaderRole()) return;
    if (!this._state.isRunning || !this._refs.endsAtMsRef.current) return;
    if (Date.now() < this._refs.endsAtMsRef.current) {
      this._scheduleCompletionTimeout();
      return;
    }
    if (this._state.secondsLeft > 0) {
      this._setField("secondsLeft", 0);
    } else {
      this._runCompletionCheck();
    }
  }

  _mergeRowPreferences(row) {
    const d = parseDurationsFromRow(row);
    const at = parseAutoTransitionFromRow(row);
    const patch = {};
    if (d) {
      patch.durations = d;
      saveStoredDurations(d);
    }
    if (at !== null) {
      patch.autoTransition = at;
      saveAutoTransition(at);
    }
    if (Object.keys(patch).length) this._patchState(patch);
  }

  _maybePlaySyncPhaseSound(prevMode, prevPhase, prevEndsAt, prevPending = null) {
    if (!this._deps.syncSession) return;
    // Only ring on a real completion — not when the controller manually
    // switched modes (the previous phase's deadline was still in the future).
    if (!this._phaseExpired(prevEndsAt)) return;
    const event = derivePhaseEndEvent(
      prevMode,
      this._state.mode,
      this._state.pendingMode,
      prevPending,
    );
    if (!event) return;
    void this._tryPlayPhaseAlarm(event, phaseAlarmKey(prevPhase, event), {
      synced: true,
    });
  }

  async _syncTickIfDue() {
    const sessionId = this._deps.syncSession?.id;
    if (!sessionId) return;
    const { data, error } = await supabase.rpc("sync_tick_if_due", {
      p_session_id: sessionId,
    });
    if (error) {
      console.warn("sync_tick_if_due:", error.message);
      return;
    }
    if (data?.session) {
      this._applyRemoteRow(data.session, { force: true });
    }
  }

  _setupSyncTickPoll() {
    if (this._syncTickCleanup) return;
    const tick = () => {
      if (this._deps.syncSession?.id) this._syncTickIfDue();
    };
    const id = setInterval(tick, 15_000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    this._syncTickCleanup = () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  async _doFlush(override) {
    return flushToServer({ ...this._getFlushDeps(), override });
  }

  async commitToPhase(nextMode, sessionsVal, autoStart) {
    await commitToPhaseCmd({
      nextMode,
      sessionsVal,
      autoStart,
      durationsRef: this._refs.durationsRef,
      flushDeps: this._getFlushDeps(),
      setters: this._getSetters(),
      markUserMutated: () => this._markUserMutated(),
      completionHandledRef: this._refs.completionHandledRef,
    });
  }

  async beginTransition(nextBreak, sessionsVal) {
    await beginTransitionCmd({
      nextBreak,
      sessionsVal,
      transitionSeconds: TRANSITION_SECONDS,
      flushDeps: this._getFlushDeps(),
      setters: this._getSetters(),
      markUserMutated: () => this._markUserMutated(),
      completionHandledRef: this._refs.completionHandledRef,
    });
  }

  async commitTransition() {
    const target = this._refs.pendingModeRef.current;
    if (!target) return;
    const sessionsVal = this._refs.sessionsRef.current;
    await this.commitToPhase(target, sessionsVal, true);
  }

  async syncFromDB({ skipIfSynced = false } = {}) {
    if (!this.userId) return;

    const maybeApply = (data, { force = false } = {}) => {
      if (!data) return;
      if (
        skipIfSynced &&
        !force &&
        Math.abs(remoteRemainingSeconds(data) - this._currentRemainingSeconds()) <= 3
      ) {
        return;
      }
      this._applyRemoteRow(data, { force });
    };

    const { syncSession } = this._deps;
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
      .eq("user_id", this.userId)
      .maybeSingle();
    maybeApply(data);
  }

  // ── Timer actions ─────────────────────────────────────────────────────────

  switchMode(newMode, { resetStreak = false } = {}) {
    if (!this._refs.canControlRef.current) return;
    stopCompletionSound();
    this._refs.completionHandledRef.current = null;
    this._markUserMutated();
    const { durations, sessions, mode } = this._state;
    const dur = durations[newMode];
    this._patchState({
      mode: newMode,
      pendingMode: null,
      secondsLeft: dur,
      isRunning: false,
      pendingAction: null,
      ...(resetStreak ? { sessions: 0 } : {}),
    });
    this._refs.endsAtMsRef.current = null;
    const nextSessions = resetStreak ? 0 : sessions;
    if (hasPersistentTimerSurface) stopPersistentTimer();
    // Switching mode discards the current countdown → clear other devices'
    // Live Activities too (see resetTimer).
    this._doFlush({
      mode: newMode,
      pending_mode: null,
      remaining_seconds: dur,
      is_running: false,
      sessions: nextSessions,
      ended: true,
    });
  }

  resetTimer() {
    if (!this._refs.canControlRef.current) return;
    stopCompletionSound();
    this._refs.completionHandledRef.current = null;
    this._markUserMutated();
    const { durations, mode } = this._state;
    const dur = durations[mode];
    this._patchState({
      secondsLeft: dur,
      pendingMode: null,
      isRunning: false,
      pendingAction: null,
    });
    this._refs.endsAtMsRef.current = null;
    if (hasPersistentTimerSurface) stopPersistentTimer();
    // `ended: true` → flushToServer pushes an APNs "end" so a reset here also
    // dismisses the user's Live Activity / widgets on their other devices.
    this._doFlush({ remaining_seconds: dur, is_running: false, pending_mode: null, ended: true });
  }

  applyCustomDuration(minutesStr, persist) {
    if (!this._refs.canControlRef.current) return;
    stopCompletionSound();
    this._refs.completionHandledRef.current = null;
    this._markUserMutated();
    const m = parseFloat(minutesStr);
    if (!Number.isFinite(m) || m <= 0) return;
    const secs = Math.max(1, Math.round(m * 60));
    const { mode, durations } = this._state;
    let nextDurations;
    if (persist) {
      nextDurations = { ...durations, [mode]: secs };
      saveStoredDurations(nextDurations);
    } else {
      nextDurations = { ...durations, [mode]: secs };
    }
    this._patchState({
      durations: nextDurations,
      secondsLeft: secs,
      pendingMode: null,
      isRunning: false,
      pendingAction: null,
    });
    this._refs.endsAtMsRef.current = null;
    if (hasPersistentTimerSurface) stopPersistentTimer();
    const flushOverride = {
      remaining_seconds: secs,
      is_running: false,
      pending_mode: null,
      // Resets the countdown to a new idle duration → dismiss other devices'
      // Live Activities (see resetTimer).
      ended: true,
    };
    if (persist) flushOverride.durations = nextDurations;
    this._doFlush(flushOverride);
  }

  requestSwitchMode(newMode) {
    const { mode, pendingAction, durations, secondsLeft, isRunning } = this._state;
    if (!this._refs.canControlRef.current || newMode === mode) return;
    if (pendingAction) return;
    if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
      this._setField("pendingAction", { type: "switchMode", newMode });
    } else {
      this.switchMode(newMode);
    }
  }

  requestReset() {
    // No confirmation. Several timer surfaces (office widget, whiteboard
    // ribbon, PiP) call reset but never render the confirm banner, which
    // left the timer stuck in a pending state with no way to confirm.
    // Reset immediately everywhere — pressing the button IS the
    // confirmation. resetTimer() already guards on canControl.
    this.resetTimer();
  }

  requestApplyCustomDuration(minutesStr, persist) {
    const { mode, pendingAction, durations, secondsLeft, isRunning } = this._state;
    if (!this._refs.canControlRef.current) return;
    if (pendingAction) return;
    if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
      this._setField("pendingAction", {
        type: "applyCustomDuration",
        minutesStr,
        persist,
      });
    } else {
      this.applyCustomDuration(minutesStr, persist);
    }
  }

  switchAlternateBreak() {
    const { pendingMode, mode, durations, secondsLeft, isRunning, pendingAction } =
      this._state;
    if (!this._refs.canControlRef.current || pendingMode) return;
    if (mode !== "shortBreak" && mode !== "longBreak") return;
    const alt = mode === "shortBreak" ? "longBreak" : "shortBreak";
    if (hasTimerProgress({ mode, durations, secondsLeft, isRunning })) {
      this._setField("pendingAction", {
        type: "switchAlternateBreak",
        newMode: alt,
      });
    } else {
      this.switchMode(alt, { resetStreak: true });
    }
  }

  confirmPendingAction() {
    const { pendingAction } = this._state;
    if (!pendingAction) return;
    if (pendingAction.type === "switchMode") {
      this.switchMode(pendingAction.newMode);
    } else if (pendingAction.type === "switchAlternateBreak") {
      this.switchMode(pendingAction.newMode, { resetStreak: true });
    } else if (pendingAction.type === "reset") {
      this.resetTimer();
    } else if (pendingAction.type === "applyCustomDuration") {
      this.applyCustomDuration(pendingAction.minutesStr, pendingAction.persist);
    }
    this._setField("pendingAction", null);
  }

  async toggleRun() {
    if (!this._refs.canControlRef.current) return;
    stopCompletionSound();
    this._markUserMutated();
    warmupAudioContext();
    const { isRunning } = this._state;
    if (!isRunning && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const willRun = !isRunning;
    if (willRun) {
      this._refs.endsAtMsRef.current =
        Date.now() + this._currentRemainingSeconds() * 1000;
    } else {
      this._refs.endsAtMsRef.current = null;
    }
    this._setField("isRunning", willRun);
    await this._doFlush({
      is_running: willRun,
      remaining_seconds: this._currentRemainingSeconds(),
    });
  }

  async skipTransition() {
    const { pendingMode } = this._state;
    if (!this._refs.canControlRef.current || !pendingMode) return;
    stopCompletionSound();
    this._markUserMutated();
    await this.commitTransition();
  }

  setAutoTransition(enabled) {
    this._patchState({ autoTransition: enabled });
    saveAutoTransition(enabled);
    if (this._refs.canControlRef.current) {
      this._doFlush({ auto_transition: enabled });
    }
  }

  cancelPendingAction() {
    this._setField("pendingAction", null);
  }

  // ── Team change ───────────────────────────────────────────────────────────

  _handleTeamChange() {
    const dur = this._refs.durationsRef.current.work;
    this._patchState({
      isRunning: false,
      pendingMode: null,
      pendingAction: null,
      sessions: 0,
      mode: "work",
      secondsLeft: dur,
    });
    this._refs.endsAtMsRef.current = null;
    this._refs.completionHandledRef.current = null;
    this._refs.userHasMutatedRef.current = false;
    const { syncSession, leaveSession } = this._deps;
    if (syncSession?.id && leaveSession) {
      leaveSession().catch(() => { /* best-effort */ });
    }
    stopCompletionSound();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  _start() {
    this._electronBridge = createElectronTimerBridge({
      onState: (snapshot) => this._applyFollowerSnapshot(snapshot),
      onCommand: (method, args) => this._executeCommand(method, args),
    });

    this._tabLeader = createTabLeader(this.userId, {
      onBecomeLeader: () => this._startLeaderLifecycle(),
      onBecomeFollower: () => this._stopLeaderLifecycle(),
      onCommand: (method, args) => this._executeCommand(method, args),
      onRemoteState: (snapshot) => this._applyFollowerSnapshot(snapshot),
    });

    this._electronBridge.start();
    this._tabLeader.start();

    if (this._forceSlave) {
      this._tabLeader.forceFollower();
    }

    if (this._electronBridge.isSlave) {
      this._refs.toggleRunRef.current = (...args) =>
        this._invokeOrForward("toggleRun", args);
      this._refs.resetTimerRef.current = (...args) =>
        this._invokeOrForward("requestReset", args);
      this._notify({ leaderSideEffects: false });
      return;
    }

    if (this._tabLeader.getIsLeader()) {
      this._startLeaderLifecycle();
    } else if (this._deps.syncSession?.id) {
      this._hydrateSync();
    }
  }

  _stop() {
    this._stopLeaderLifecycle();
    this._syncTickCleanup?.();
    this._syncTickCleanup = null;
    this._electronBridge?.stop();
    this._tabLeader?.stop();
    this._electronBridge = null;
    this._tabLeader = null;
  }

  _startLeaderLifecycle() {
    if (this._leaderLifecycleActive) return;
    if (this._electronBridge?.isSlave) return;
    this._leaderLifecycleActive = true;
    this._soloHydrateCancelled = false;
    this._lockscreenCancelled = false;

    this._refs.toggleRunRef.current = () => this.toggleRun();
    this._refs.resetTimerRef.current = () => this.resetTimer();

    if (this._deps.syncSession?.id) {
      this._hydrateSync();
    } else {
      this._hydrateSolo();
    }

    this._setupRealtime();
    this._setupVisibilitySync();
    this._setupIntervals();
    this._setupTimerTick();
    this._setupLockscreenReconcile();
    this._setupSyncTickPoll();
    // Force the first derived pass to (re)establish the native activity /
    // notification regardless of any stale fingerprint from a prior leadership.
    this._lastNativeSideEffectFp = null;
    this._runDerivedSideEffects();
    this._notify({ leaderSideEffects: false });
  }

  _stopLeaderLifecycle() {
    if (!this._leaderLifecycleActive) return;
    this._leaderLifecycleActive = false;
    this._soloHydrateCancelled = true;
    this._lockscreenCancelled = true;
    this._clearCompletionTimeout();
    this._syncTickCleanup?.();
    this._syncTickCleanup = null;
    for (const cleanup of this._cleanups) cleanup();
    this._cleanups = [];
    this._realtimeWasSubscribed = { solo: false, sync: false };
    cancelPomodoroNotification();
  }

  _addCleanup(fn) {
    this._cleanups.push(fn);
  }

  _teardownRealtime() {
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      const fn = this._cleanups[i];
      if (fn.__pomodoroRealtime) {
        fn();
        this._cleanups.splice(i, 1);
      }
    }
    this._realtimeWasSubscribed = { solo: false, sync: false };
  }

  async _hydrateSolo() {
    if (!this.userId || this._deps.syncSession) return;
    this._soloHydrateCancelled = false;

    const lockscreenAction = await consumePendingTimerToggle();
    if (this._soloHydrateCancelled) return;

    if (lockscreenAction.pendingStop) {
      this._refs.resetTimerRef.current?.();
      return;
    }
    if (
      lockscreenAction.pending &&
      lockscreenAction.nowRunning !== this._refs.latestRef.current.isRunning
    ) {
      this._refs.toggleRunRef.current?.();
    }

    const { data, error } = await supabase
      .from("user_pomodoro_state")
      .select("*")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (this._soloHydrateCancelled || error || !data) return;

    const remoteMs = remoteUpdatedAtMs(data);
    const lastWriteMs = this._refs.lastLocalWriteAtMsRef.current;
    if (this._refs.userHasMutatedRef.current) {
      if (lastWriteMs == null) return;
      if (remoteMs != null && remoteMs < lastWriteMs - 100) return;
    }
    this._refs.suppressRemoteUntilRef.current = 0;
    this._applyRemoteRow(data);
    this._refs.suppressRemoteUntilRef.current = Date.now() + 400;
  }

  async _hydrateSync() {
    if (!this._deps.syncSession?.id) return;
    this._refs.suppressRemoteUntilRef.current = 0;
    await this.syncFromDB({ force: true });
    this._refs.suppressRemoteUntilRef.current = Date.now() + 400;
  }

  _setupRealtime() {
    const { syncSession } = this._deps;

    if (!syncSession?.id && this.userId) {
      let wasSubscribed = false;
      const channel = supabase
        .channel(`pomodoro:${this.userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_pomodoro_state",
            filter: `user_id=eq.${this.userId}`,
          },
          (payload) => {
            const row = payload.new;
            if (row && typeof row === "object") this._applyRemoteRow(row);
          }
        )
        .subscribe((status) => {
          this._setField("realtimeStatus", status);
          if (status === "SUBSCRIBED") {
            if (wasSubscribed) this.syncFromDB();
            wasSubscribed = true;
            this._realtimeWasSubscribed.solo = true;
          }
        });

      const cleanup = () => {
        supabase.removeChannel(channel);
      };
      cleanup.__pomodoroRealtime = true;
      this._addCleanup(cleanup);
      return;
    }

    if (syncSession?.id) {
      let wasSubscribed = false;
      const sessionId = syncSession.id;
      const channel = supabase
        .channel(`sync-session-timer:${sessionId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "sync_sessions",
            filter: `id=eq.${sessionId}`,
          },
          (payload) => {
            const row = payload.new;
            if (row && typeof row === "object") {
              if (row.status === "ended") {
                this._deps.leaveSession?.();
                return;
              }
              this._applyRemoteRow(row);
            }
          }
        )
        .subscribe((status) => {
          this._setField("realtimeStatus", status);
          if (status === "SUBSCRIBED") {
            if (wasSubscribed) this.syncFromDB();
            wasSubscribed = true;
            this._realtimeWasSubscribed.sync = true;
          }
        });

      const cleanup = () => {
        supabase.removeChannel(channel);
      };
      cleanup.__pomodoroRealtime = true;
      this._addCleanup(cleanup);
    }
  }

  _setupVisibilitySync() {
    if (!this.userId) return;
    const onVisible = () => {
      if (!document.hidden) {
        this.syncFromDB();
        if (this._leaderLifecycleActive) this._onWallClockDue();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    this._addCleanup(() => {
      document.removeEventListener("visibilitychange", onVisible);
    });
  }

  _setupIntervals() {
    let runningIntervalId = null;
    let lastIsRunning = this._state.isRunning;

    const updateRunningInterval = () => {
      if (runningIntervalId) {
        clearInterval(runningIntervalId);
        runningIntervalId = null;
      }
      if (this._state.isRunning && this.userId) {
        runningIntervalId = setInterval(
          () => this.syncFromDB({ skipIfSynced: true }),
          30_000
        );
      }
    };

    updateRunningInterval();

    const watchId = setInterval(() => {
      if (this._state.isRunning !== lastIsRunning) {
        lastIsRunning = this._state.isRunning;
        updateRunningInterval();
      }
    }, 250);

    const alwaysId = setInterval(() => this.syncFromDB(), 60_000);

    this._addCleanup(() => {
      if (runningIntervalId) clearInterval(runningIntervalId);
      clearInterval(watchId);
      clearInterval(alwaysId);
    });
  }

  _setupTimerTick() {
    const tick = () => {
      if (!this._state.isRunning) return;
      const { userId } = this;
      const endsAtMsRef = this._refs.endsAtMsRef;
      this._setField("secondsLeft", (s) => {
        if (userId && endsAtMsRef.current) {
          return Math.max(
            0,
            Math.ceil((endsAtMsRef.current - Date.now()) / 1000)
          );
        }
        return s <= 1 ? 0 : s - 1;
      });
    };

    const id = setInterval(tick, 1000);
    this._addCleanup(() => clearInterval(id));
  }

  _setupLockscreenReconcile() {
    if (!hasPersistentTimerSurface || !this.userId) return;
    this._lockscreenCancelled = false;

    const reconcile = async () => {
      const { pending, nowRunning, pendingStop } = await consumePendingTimerToggle();
      if (this._lockscreenCancelled) return;
      if (pendingStop) {
        this._refs.resetTimerRef.current?.();
        return;
      }
      if (pending && nowRunning !== this._refs.latestRef.current.isRunning) {
        this._refs.toggleRunRef.current?.();
      }
    };

    reconcile();
    const interval = setInterval(reconcile, 2000);
    const onVisible = () => {
      if (!document.hidden) reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    this._addCleanup(() => {
      this._lockscreenCancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    });
  }

  _runDerivedSideEffects() {
    const {
      isRunning,
      mode,
      pendingMode,
      secondsLeft,
    } = this._state;
    const { syncSession, userCustomSounds, teamSounds } = this._deps;
    const isSynced = !!syncSession;

    // The native side-effects below (iOS ActivityKit Live Activity + an
    // activity-register edge-function fetch + a LocalNotifications.schedule)
    // are all driven by the ABSOLUTE deadline (endsAt) + phase — the native
    // side counts down on its own. So they only need to fire when those
    // meaningful inputs change (start / phase change / pause / resume), NOT on
    // every 1s `secondsLeft` tick. Without this guard a running timer fired
    // ~one ActivityKit start + one fetch + one bridge schedule PER SECOND
    // (~1,140 over 19 min), which OOM-killed the iOS WebView while the phone
    // sat idle with a timer running.
    const phaseMode = pendingMode || mode;
    const durationSeconds = this._state.durations?.[phaseMode];
    const endsAt = isRunning
      ? (this._refs.endsAtMsRef.current || Date.now() + secondsLeft * 1000)
      : null;
    const fp = [
      isRunning ? 1 : 0,
      phaseMode,
      endsAt ? Math.round(endsAt / 1000) : 0,
      isSynced ? 1 : 0,
      durationSeconds || 0,
    ].join("|");

    if ((isMobileApp || hasPersistentTimerSurface) && fp !== this._lastNativeSideEffectFp) {
      this._lastNativeSideEffectFp = fp;

      if (isMobileApp) {
        if (!isRunning) {
          cancelPomodoroNotification();
        } else {
          const settings = loadPomodoroSoundSettings();
          const presetId =
            mode === "work" ? settings.workEndPreset : settings.breakEndPreset;
          schedulePomodoroNotification({
            endsAtMs: endsAt,
            mode,
            isSynced,
            presetId,
            userSounds: userCustomSounds,
            teamSounds,
          });
        }
      }

      if (hasPersistentTimerSurface) {
        // The Airy widget ring needs the full phase length to know how full it
        // is (work/shortBreak/longBreak each differ, and durations are custom).
        if (isRunning) {
          startPersistentTimer({ endsAtMs: endsAt, mode: phaseMode, isSynced, durationSeconds });
        } else {
          pausePersistentTimer({
            pausedSecondsLeft: secondsLeft,
            mode: phaseMode,
            isSynced,
            durationSeconds,
          });
        }
      }
    }

    if (this._isLeaderRole()) {
      if (isRunning && this._refs.endsAtMsRef.current) {
        this._scheduleCompletionTimeout();
      } else {
        this._clearCompletionTimeout();
      }
    }
  }

  _runCompletionCheck() {
    const { isRunning, secondsLeft } = this._state;
    if (!isRunning || secondsLeft > 0) return;

    const completionKey = this._completionKey();
    if (this._refs.completionHandledRef.current === completionKey) return;
    this._refs.completionHandledRef.current = completionKey;

    const { syncSession } = this._deps;
    const isSynced = !!syncSession;

    if (isSynced) {
      const currentMode = this._refs.modeRef.current;
      const event = currentMode === "work" ? "work" : "break";
      void this._tryPlayPhaseAlarm(event, phaseAlarmKey(completionKey, event), {
        synced: true,
      });
      this._syncTickIfDue();
      return;
    }

    const currentPending = this._refs.pendingModeRef.current;

    if (currentPending) {
      this.commitTransition();
      return;
    }

    this._setField("isRunning", false);

    const currentMode = this._refs.modeRef.current;
    const currentSessions = this._refs.sessionsRef.current;

    void this._tryPlayPhaseAlarm(
      currentMode === "work" ? "work" : "break",
      phaseAlarmKey(completionKey, currentMode === "work" ? "work" : "break"),
      { synced: false },
    );

    if (currentMode === "work") {
      const nextStreak = currentSessions + 1;
      const nextBreak = defaultBreakForStreak(nextStreak);
      this._setField("sessions", nextStreak);
      if (this._refs.autoTransitionRef.current) {
        this.beginTransition(nextBreak, nextStreak);
      } else {
        this.commitToPhase(nextBreak, nextStreak, true);
      }
    } else {
      const nextSessions = currentMode === "longBreak" ? 0 : currentSessions;
      this._setField("sessions", nextSessions);
      this.commitToPhase("work", nextSessions, false);
    }
  }
}
